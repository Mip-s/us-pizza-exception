// Finding exceptions for some business days (POST /api/detect, after an upload).
//
// For each day and outlet, judged only from the days before it:
//   sales_drop / no_sales  what the outlet should have sold — Chronos-2 on Modal (POST {MODAL_URL}/expect, one call for
//                          all the days; outlets with >= 14 days of sales) and, for the rest or when Modal can't be
//                          reached, the weekday baseline (rules.weekdayBaseline). Below half = sales_drop; no sales at
//                          all on a day the report covers, for an outlet that sold in the 7 days before = no_sales.
//   discount_spike         discount share of gross far above the outlet's own last 28 days (rules.judgeDiscount)
//   void_spike             RM voided far above the outlet's own last 28 days (rules.judgeVoids) — only on days a
//                          voids export covered (no voids export = not checked, not "no voids")
// Every exception carries `impact` (RM at stake) so the board and the morning push can rank them.
// Exceptions are saved (re-checking a day updates its numbers, keeps its status, and removes an open exception that no
// longer applies). Pushes are sent separately (notify.js).

import { sb } from './supabase.js';
import {
  addDays, judge, judgeDiscount, judgeVoids, weekdayBaseline, todayMYT,
  HISTORY_DAYS, BASELINE_MIN_DAYS, NOTIFY_RECENT_DAYS, DETECT_PER_CALL, TRAIL_DAYS,
} from './rules.js';

async function chronos(env, series, days) {
  if (!env.MODAL_URL || !env.EXCEPTION_API_KEY) return { error: 'MODAL_URL / EXCEPTION_API_KEY not set' };
  try {
    const res = await fetch(env.MODAL_URL.replace(/\/$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: env.EXCEPTION_API_KEY, series, days }),
      signal: AbortSignal.timeout(120000), // a cold Modal container can take ~1 min
    });
    if (!res.ok) return { error: `Modal HTTP ${res.status}` };
    const body = await res.json();
    return { expected: body.expected || [] };
  } catch (err) {
    return { error: `Modal: ${err.message}` };
  }
}

// every exception row has the same keys (PostgREST bulk upsert)
const row = (o, day, now, f) => ({
  outlet_id: o, business_date: day, kind: f.kind,
  net_sales: f.net_sales ?? null, expected: f.expected ?? null, usual_low: f.usual_low ?? null, usual_high: f.usual_high ?? null,
  pct_of_expected: f.pct_of_expected ?? null, bills: f.bills ?? null, method: f.method ?? null,
  value: f.value ?? null, usual: f.usual ?? null, impact: f.impact ?? null, same_day: 0, updated_at: new Date(now).toISOString(),
});

export async function runDetect(env, days, now = Date.now()) {
  days = [...new Set(days)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-DETECT_PER_CALL);
  if (!days.length) return { days: [], flagged: 0 };
  const db = sb(env);
  const from = addDays(days[0], -HISTORY_DAYS);
  const to = days[days.length - 1];
  const voidFrom = addDays(days[0], -TRAIL_DAYS);
  const [rows, voidRows, voidBatches] = await Promise.all([
    db.all(`daily_sales?select=outlet_id,business_date,net,bills,gross,discount&business_date=gte.${from}&business_date=lte.${to}&order=outlet_id,business_date`),
    db.all(`daily_voids?select=outlet_id,business_date,net,bills&business_date=gte.${voidFrom}&business_date=lte.${to}`),
    db.get(`import_batches?select=date_from,date_to&kind=eq.voids&date_from=lte.${to}&date_to=gte.${voidFrom}`),
  ]);
  const voidCovered = (d) => voidBatches.some((b) => b.date_from <= d && d <= b.date_to);
  const voidBy = {};
  for (const v of voidRows) voidBy[`${v.outlet_id}|${v.business_date}`] = v;

  // history per outlet (sales > 0 only), and who sold on each day
  const byOutlet = {};
  const onDay = {};
  for (const r of rows) {
    r.net = Number(r.net);
    if (r.net > 0) (byOutlet[r.outlet_id] ||= []).push(r);
    (onDay[r.business_date] ||= {})[r.outlet_id] = r;
  }
  const outlets = Object.keys(byOutlet);

  // Chronos-2: all days in one call
  const series = outlets.map((o) => ({ id: o, dates: byOutlet[o].map((r) => r.business_date), values: byOutlet[o].map((r) => r.net) }));
  const ai = await chronos(env, series, days);
  const aiBy = {};
  for (const e of ai.expected || []) aiBy[`${e.id}|${e.date}`] = e;

  // baseline from the history before the first day (one pass: cheap on the Worker's CPU)
  const base = weekdayBaseline(rows.filter((r) => r.business_date < days[0] && r.net > 0));

  const flags = [];
  let checked = 0;
  const checkedDays = new Set();
  for (const day of days) {
    const sold = onDay[day] || {};
    if (Object.keys(sold).length < 5) continue; // this day isn't really in the uploaded data
    checkedDays.add(day);
    const voidsToday = voidCovered(day);
    const salesFlags = [];
    for (const o of outlets) {
      const before = byOutlet[o].filter((r) => r.business_date < day && r.business_date >= addDays(day, -HISTORY_DAYS));
      const sale = sold[o] ? { net: sold[o].net, bills: sold[o].bills } : null;

      // sales below expected / missing
      if (before.length >= BASELINE_MIN_DAYS && (sale || before.some((r) => r.business_date >= addDays(day, -7)))) {
        const a = aiBy[`${o}|${day}`];
        const exp = a
          ? { expected: a.p50, low: a.p10, high: a.p90, method: 'chronos2' }
          : base(o, day) != null ? { expected: base(o, day), low: null, high: null, method: 'baseline' } : null;
        checked += 1;
        const j = judge(sale, exp);
        if (j) {
          salesFlags.push(row(o, day, now, {
            kind: j.kind, net_sales: round(j.net_sales), expected: round(exp.expected),
            usual_low: exp.low == null ? null : round(exp.low), usual_high: exp.high == null ? null : round(exp.high),
            pct_of_expected: j.pct_of_expected, bills: sale?.bills ?? 0, method: exp.method,
            impact: Math.round(Math.max(exp.expected - (sale?.net || 0), 0)),
          }));
        }
      }
      if (!sale) continue;

      // the outlet's own last 28 days (that it traded)
      const trail = before.filter((r) => r.business_date >= addDays(day, -TRAIL_DAYS));

      const d = judgeDiscount(sold[o], trail.filter((r) => Number(r.gross) > 0));
      if (d) flags.push(row(o, day, now, { ...d, net_sales: round(sale.net), bills: sale.bills }));

      if (voidsToday) {
        const hist = trail.filter((r) => voidCovered(r.business_date)).map((r) => Number(voidBy[`${o}|${r.business_date}`]?.net) || 0);
        const today = voidBy[`${o}|${day}`];
        const v = judgeVoids(Number(today?.net) || 0, hist, sale.net);
        if (v) flags.push(row(o, day, now, { ...v, net_sales: round(sale.net), bills: today?.bills ?? null }));
      }
    }
    for (const f of salesFlags) f.same_day = salesFlags.length - 1; // several outlets low together = a common cause
    flags.push(...salesFlags);
  }

  // save: update numbers of existing ones (status / note kept), add new ones, drop open ones that no longer apply
  const existing = await db.get(`exceptions?select=id,outlet_id,business_date,kind,status&business_date=gte.${days[0]}&business_date=lte.${to}`);
  if (flags.length) await db.upsert('exceptions', flags, 'outlet_id,business_date,kind');
  const keep = new Set(flags.map((f) => `${f.outlet_id}|${f.business_date}|${f.kind}`));
  const stale = existing.filter((e) => e.status === 'open' && checkedDays.has(e.business_date)
    && (e.kind !== 'void_spike' || voidCovered(e.business_date))
    && !keep.has(`${e.outlet_id}|${e.business_date}|${e.kind}`));
  if (stale.length) await db.del(`exceptions?id=in.(${stale.map((e) => e.id).join(',')})`);
  // back-filled days (older than NOTIFY_RECENT_DAYS) are listed on the board but never pushed
  const quietBefore = addDays(todayMYT(now), -NOTIFY_RECENT_DAYS);
  if (days[0] < quietBefore) {
    await db.patch(`exceptions?notified_at=is.null&business_date=lt.${quietBefore}`, { notified_at: new Date(now).toISOString() });
  }
  const count = (k) => flags.filter((f) => f.kind === k).length;
  return {
    days, checked, flagged: flags.length, removed: stale.length,
    sales: count('sales_drop') + count('no_sales'), discounts: count('discount_spike'), voids: count('void_spike'),
    voids_checked: days.filter((d) => checkedDays.has(d) && voidCovered(d)).length,
    method: ai.error ? 'baseline' : 'chronos2', ...(ai.error ? { model_error: ai.error } : {}),
  };
}

const round = (v) => Math.round(Number(v) * 100) / 100;
