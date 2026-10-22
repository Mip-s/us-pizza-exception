// Possible causes for each exception (POST /api/explain, run by the board after each upload's check).
//
// The Worker first collects FACTS about the outlet and the day — calendar (holidays, school holidays, Ramadan,
// payday), rain at the outlet during opening hours (Open-Meteo, no key), promotions on that day (exception_agent.
// promotions, entered by operations), how the whole chain / the region did that day (a common cause), the outlet's
// own pattern (bills vs average ticket, days before / after), and the other modules (POS downtime from the Uptime
// Monitor's D1, open equipment faults, bad reviews). Then Workers AI is asked to rank the likely causes using ONLY
// those facts. If the AI can't be reached, simple rules on the same facts give the causes instead (source "rules").
// Saved on the exception: causes [{cause, likelihood, evidence, check}], cause_tag (a few words for the push), context.

import { sb } from './supabase.js';
import { calendarFacts } from './calendar.js';
import { addDays, todayMYT, robust } from './rules.js';

export const EXPLAIN_PER_CALL = 6; // Workers AI calls per request (Cloudflare's 50-subrequest cap per request)
export const AUTO_DAYS = 7; // new exceptions of the last 7 days are explained automatically after each upload
const AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'; // same model as Review Watcher
const OPEN_FROM = 11; // opening hours used for "rain while open" (11:00–21:59)
const OPEN_TO = 21;

const r0 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
const r1 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const med = (a) => (a.length ? robust(a).median : null);
const pctOf = (a, b) => (a == null || !b ? null : Math.round((100 * a) / b));

// ---------- weather (Open-Meteo, hourly rain) ----------
async function weather(points, from, to, today) {
  if (!points.length) return {};
  const old = from < addDays(today, -85); // the forecast API keeps ~3 months of past days; older -> archive API
  const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const url = `${host}?latitude=${points.map((p) => p.lat).join(',')}&longitude=${points.map((p) => p.lon).join(',')}`
    + `&hourly=precipitation&start_date=${from}&end_date=${to}&timezone=Asia%2FKuala_Lumpur`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'us-pizza-exception-agent' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `weather HTTP ${res.status}` };
    let body = await res.json();
    if (!Array.isArray(body)) body = [body];
    const out = {};
    body.forEach((b, i) => {
      const byDay = {};
      (b.hourly?.time || []).forEach((t, j) => {
        const h = Number(t.slice(11, 13));
        if (h < OPEN_FROM || h > OPEN_TO) return;
        const d = t.slice(0, 10);
        const mm = Number(b.hourly.precipitation[j]) || 0;
        const x = (byDay[d] ||= { mm: 0, wet: 0, peak: 0, peakAt: null });
        x.mm += mm;
        if (mm >= 0.5) x.wet += 1;
        if (mm > x.peak) { x.peak = mm; x.peakAt = t.slice(11, 16); }
      });
      out[points[i].key] = byDay;
    });
    return out;
  } catch (err) {
    return { error: `weather: ${err.message}` };
  }
}

function weatherFacts(byDay, day) {
  if (!byDay || !byDay[day]) return null;
  const x = byDay[day];
  const before = Object.entries(byDay).filter(([d]) => d < day && d >= addDays(day, -14)).map(([, v]) => v.mm);
  const f = {
    rain_mm_while_open: r1(x.mm), hours_with_rain_while_open: x.wet,
    usual_rain_mm_while_open_last_14_days: r1(med(before)),
  };
  if (x.peak >= 1) f.heaviest_rain = `${r1(x.peak)} mm around ${x.peakAt}`;
  f.summary = x.mm >= 15 || x.wet >= 4 ? 'heavy rain while open' : x.mm >= 4 || x.wet >= 2 ? 'some rain while open' : 'dry while open';
  return f;
}

// ---------- the outlet's own numbers ----------
function salesOf(salesBy, o, d) { return salesBy[`${o}|${d}`]; }
function expectedNet(salesBy, o, day) {
  const wk = [7, 14, 21, 28].map((n) => salesOf(salesBy, o, addDays(day, -n))).filter((s) => s && s.net > 0).map((s) => s.net);
  if (wk.length >= 3) return med(wk);
  const all = [];
  for (let i = 1; i <= 28; i += 1) { const s = salesOf(salesBy, o, addDays(day, -i)); if (s && s.net > 0) all.push(s.net); }
  return all.length >= 7 ? med(all) : null;
}
function trail(salesBy, o, day, n = 28) {
  const out = [];
  for (let i = 1; i <= n; i += 1) { const s = salesOf(salesBy, o, addDays(day, -i)); if (s && s.net > 0) out.push({ ...s, d: addDays(day, -i) }); }
  return out;
}

function outletFacts(e, salesBy, voidBy, voidCovered) {
  const o = e.outlet_id;
  const day = e.business_date;
  const s = salesOf(salesBy, o, day);
  const t = trail(salesBy, o, day);
  const usualBills = med(t.map((x) => Number(x.bills) || 0).filter((x) => x > 0));
  const usualTicket = med(t.filter((x) => x.bills > 0).map((x) => x.net / x.bills));
  const exp = expectedNet(salesBy, o, day);
  const f = {
    net_sales: r0(s?.net ?? 0), expected_net_sales: r0(exp), pct_of_expected: pctOf(s?.net ?? 0, exp),
    bills: s?.bills ?? 0, usual_bills: r0(usualBills), pct_of_usual_bills: pctOf(s?.bills ?? 0, usualBills),
    avg_ticket: s?.bills ? r0(s.net / s.bills) : null, usual_avg_ticket: r0(usualTicket),
    same_weekday_last_4_weeks: [7, 14, 21, 28].map((n) => r0(salesOf(salesBy, o, addDays(day, -n))?.net ?? 0)),
  };
  const ratio = (d) => { const x = salesOf(salesBy, o, d); const ex = expectedNet(salesBy, o, d); return x && ex ? pctOf(x.net, ex) : null; };
  f.day_before_pct_of_expected = ratio(addDays(day, -1));
  f.day_after_pct_of_expected = ratio(addDays(day, 1));
  if (s && Number(s.gross) > 0) {
    f.discount_pct_of_gross = r1((100 * s.discount) / s.gross);
    f.usual_discount_pct = r1(med(t.filter((x) => x.gross > 0).map((x) => (100 * x.discount) / x.gross)));
  }
  if (voidCovered(day)) {
    const v = voidBy[`${o}|${day}`];
    f.voided_rm = r0(Math.max(Number(v?.net) || 0, 0));
    f.voided_bills = v?.bills || 0;
    const hist = t.filter((x) => voidCovered(x.d)).map((x) => Math.max(Number(voidBy[`${o}|${x.d}`]?.net) || 0, 0));
    f.usual_voided_rm_per_day = r0(med(hist));
    f.days_with_voids_in_last_28 = hist.filter((x) => x > 0).length;
    if (v?.bills) f.avg_rm_per_voided_bill = r0(Math.max(v.net, 0) / v.bills);
  }
  return f;
}

// how everyone (and the outlet's region) did that day: a chain-wide dip points to a common cause
function peerFacts(e, outlets, salesBy, voidBy, voidCovered, excByDay) {
  const day = e.business_date;
  const me = outlets[e.outlet_id];
  const sum = (filter) => {
    let net = 0; let exp = 0; let disc = 0; let gross = 0; let n = 0; let usualDisc = []; let voids = 0;
    for (const o of Object.values(outlets).filter(filter)) {
      if (o.outlet_id === e.outlet_id) continue;
      const s = salesOf(salesBy, o.outlet_id, day);
      const ex = expectedNet(salesBy, o.outlet_id, day);
      if (!s || !ex) continue;
      n += 1; net += s.net; exp += ex; disc += Number(s.discount) || 0; gross += Number(s.gross) || 0;
      usualDisc.push(...trail(salesBy, o.outlet_id, day, 14).filter((x) => x.gross > 0).map((x) => (100 * x.discount) / x.gross));
      voids += Math.max(Number(voidBy[`${o.outlet_id}|${day}`]?.net) || 0, 0);
    }
    if (!n) return null;
    const f = { outlets: n, sales_pct_of_expected: pctOf(net, exp) };
    if (gross) { f.discount_pct_of_gross = r1((100 * disc) / gross); f.usual_discount_pct = r1(med(usualDisc)); }
    if (voidCovered(day)) f.voided_rm_total = r0(voids);
    return f;
  };
  const ex = (excByDay[day] || []).filter((x) => x.outlet_id !== e.outlet_id);
  const count = (list) => list.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] || 0) + 1 }), {});
  return {
    whole_chain_that_day: sum(() => true),
    same_region_that_day: me?.region ? { region: me.region, ...sum((o) => o.region === me.region) } : null,
    other_outlets_flagged_that_day: count(ex),
    other_outlets_flagged_in_same_region: count(ex.filter((x) => outlets[x.outlet_id]?.region === me?.region)),
  };
}

// ---------- the prompt ----------
const KIND_TEXT = {
  sales_drop: 'net sales far below what was expected for this outlet and day',
  no_sales: 'no sales at all in the report for this outlet on this day (it was selling the week before)',
  discount_spike: 'discounts far above this outlet\'s usual share of gross sales',
  void_spike: 'voided / cancelled bills far above this outlet\'s usual',
};

export function buildMessages(e, outlet, facts) {
  const system = 'You are an operations analyst for US Pizza, a pizza chain in Malaysia and Singapore (dine-in, takeaway and delivery via Grab, foodpanda and ShopeeFood). '
    + 'You explain why an outlet was flagged, for the area manager and head of operations. '
    + 'Use ONLY the facts given. Never invent events, promotions, weather or numbers. If the facts do not explain it, say so and suggest what to check. '
    + 'Reason like an experienced F&B ops manager: e.g. fewer bills = fewer customers (weather, holiday, mall traffic, outlet closed early, POS/delivery app down); same bills but lower average ticket = smaller orders or a pricing/discount issue; '
    + 'a dip shared by the whole chain or region = common cause (weather, holiday, system), not the outlet; discounts up with bills up = probably a promotion; discounts up without more bills or chain-wide = check staff discount use; '
    + 'many voids on a normal day = check cashier voids / refunds / order mistakes; one big void = possibly a cancelled bulk or catering order. '
    + 'Answer with JSON only: {"tag": "<the top cause in at most 4 words>", "causes": [{"cause": "<short>", "likelihood": "high|medium|low", "evidence": "<the facts that point to it, with numbers>", "check": "<what the manager should check or ask the outlet>"}]}. '
    + 'Give 1 to 3 causes, most likely first. Keep each field under 25 words. Plain English.';
  const user = `Outlet: ${outlet.code} ${String(outlet.name).replace(/^US Pizza /, '')} (${[outlet.region, outlet.state, outlet.country].filter(Boolean).join(', ')})\n`
    + `Day: ${e.business_date}\nFlagged: ${KIND_TEXT[e.kind]}\nFacts (JSON):\n${JSON.stringify(facts)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: `${user}\n/no_think` }];
}

const LIKELIHOOD = ['high', 'medium', 'low'];
export function parseCauses(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const causes = (Array.isArray(o?.causes) ? o.causes : []).slice(0, 3).map((c) => ({
    cause: clip(c.cause, 120), likelihood: LIKELIHOOD.includes(String(c.likelihood).toLowerCase()) ? String(c.likelihood).toLowerCase() : 'low',
    evidence: clip(c.evidence, 240), check: clip(c.check, 240),
  })).filter((c) => c.cause);
  if (!causes.length) return null;
  return { tag: clip(o.tag, 40) || causes[0].cause.slice(0, 40), causes };
}

// ---------- rules, when the AI can't answer ----------
export function ruleCauses(e, f) {
  const c = [];
  const w = f.weather;
  const peers = f.others?.whole_chain_that_day;
  if (f.ops?.pos_downtime_minutes >= 30) c.push({ cause: 'POS / KDS was down', likelihood: 'high', evidence: `${f.ops.pos_downtime_minutes} min of downtime that day`, check: 'Confirm with the outlet and the Uptime Monitor' });
  if (f.ops?.open_faults?.length) c.push({ cause: 'Equipment fault open', likelihood: 'medium', evidence: f.ops.open_faults.map((x) => x.asset).join(', '), check: 'Check the fault in the Maintenance Tracker' });
  if (['sales_drop', 'no_sales'].includes(e.kind)) {
    if (e.kind === 'no_sales') c.push({ cause: 'Outlet closed or report missing', likelihood: 'high', evidence: 'No sales row for the day', check: 'Ask the outlet if it opened; check the Codemax export' });
    if (w?.summary === 'heavy rain while open') c.push({ cause: 'Heavy rain', likelihood: 'medium', evidence: `${w.rain_mm_while_open} mm over ${w.hours_with_rain_while_open} h while open`, check: 'Compare delivery vs dine-in for the day' });
    if (f.calendar?.public_holiday || f.calendar?.eve_of_holiday) c.push({ cause: 'Holiday effect', likelihood: 'medium', evidence: f.calendar.public_holiday || `eve of ${f.calendar.eve_of_holiday}`, check: 'Compare with the same holiday last year' });
    if (peers?.sales_pct_of_expected != null && peers.sales_pct_of_expected < 85) c.push({ cause: 'Slow day across the chain', likelihood: 'medium', evidence: `chain at ${peers.sales_pct_of_expected}% of expected`, check: 'No outlet-specific action likely' });
  }
  if (e.kind === 'discount_spike') {
    if (f.promotions?.length) c.push({ cause: `Promotion: ${f.promotions[0].name}`, likelihood: 'high', evidence: 'Promotion running that day', check: 'Confirm the outlet ran it' });
    else if (peers?.discount_pct_of_gross != null && peers.discount_pct_of_gross - (peers.usual_discount_pct || 0) >= 5) c.push({ cause: 'Company-wide promotion likely', likelihood: 'medium', evidence: `chain discounts ${peers.discount_pct_of_gross}% vs usual ${peers.usual_discount_pct}%`, check: 'Ask marketing; add it to Promotions' });
    else c.push({ cause: 'Outlet-only discounting', likelihood: 'medium', evidence: 'Not seen at other outlets', check: 'Check discount reasons and who applied them' });
  }
  if (e.kind === 'void_spike') c.push({ cause: f.outlet?.voided_bills <= 2 ? 'Large order voided' : 'Many voided bills', likelihood: 'medium', evidence: `${f.outlet?.voided_bills} bills, RM${f.outlet?.voided_rm}`, check: 'Check the void log: who voided and why' });
  if (!c.length) c.push({ cause: 'No clear cause in the data', likelihood: 'low', evidence: 'Weather, calendar and other outlets look normal', check: 'Ask the outlet manager what happened' });
  return { tag: c[0].cause.slice(0, 40), causes: c.slice(0, 3) };
}

// ---------- main ----------
// ids: explain these (button); otherwise the newest unexplained exceptions of the last AUTO_DAYS days
export async function runExplain(env, { ids = null, now = Date.now() } = {}) {
  const db = sb(env);
  const today = todayMYT(now);
  const sel = 'id,outlet_id,business_date,kind,net_sales,expected,pct_of_expected,value,usual,impact,bills';
  const list = ids?.length
    ? await db.get(`exceptions?select=${sel}&id=in.(${ids.map(Number).filter(Boolean).join(',')})&limit=${EXPLAIN_PER_CALL}`)
    : await db.get(`exceptions?select=${sel}&causes_at=is.null&business_date=gte.${addDays(today, -AUTO_DAYS)}&order=impact.desc.nullslast&limit=${EXPLAIN_PER_CALL}`);
  if (!list.length) return { explained: 0, left: 0 };

  const days = list.map((e) => e.business_date).sort();
  const from = addDays(days[0], -35);
  const to = addDays(days[days.length - 1], 1);
  const ids2 = [...new Set(list.map((e) => e.outlet_id))];
  const pub = sb(env, { schema: 'public' });
  const [outletRows, geo, sales, voids, voidBatches, excs, promos] = await Promise.all([
    pub.get('outlets?select=outlet_id,code,name,region,state,country&monitored=is.true'),
    db.get(`outlet_geo?select=outlet_id,lat,lon&outlet_id=in.(${ids2.join(',')})`),
    db.all(`daily_sales?select=outlet_id,business_date,net,gross,discount,bills&business_date=gte.${from}&business_date=lte.${to}`),
    db.all(`daily_voids?select=outlet_id,business_date,net,bills&business_date=gte.${from}&business_date=lte.${to}`),
    db.get(`import_batches?select=date_from,date_to&kind=eq.voids&date_from=lte.${to}&date_to=gte.${from}`),
    db.get(`exceptions?select=outlet_id,business_date,kind&business_date=gte.${days[0]}&business_date=lte.${days[days.length - 1]}`),
    db.get(`promotions?select=name,source,starts,ends,regions,outlet_ids,note&starts=lte.${to}&ends=gte.${days[0]}`),
  ]);
  const outlets = Object.fromEntries(outletRows.map((o) => [o.outlet_id, o]));
  const salesBy = {};
  for (const s of sales) salesBy[`${s.outlet_id}|${s.business_date}`] = { net: Number(s.net), gross: Number(s.gross), discount: Number(s.discount), bills: Number(s.bills) || 0 };
  const voidBy = {};
  for (const v of voids) voidBy[`${v.outlet_id}|${v.business_date}`] = { net: Number(v.net), bills: v.bills };
  const voidCovered = (d) => voidBatches.some((b) => b.date_from <= d && d <= b.date_to);
  const excByDay = {};
  for (const x of excs) (excByDay[x.business_date] ||= []).push(x);

  // weather for the outlets' locations, 14 days before the first day (for "usual rain") to the last day
  const points = [];
  const pointOf = {};
  for (const g of geo) {
    const key = `${Number(g.lat).toFixed(2)},${Number(g.lon).toFixed(2)}`;
    if (!points.some((p) => p.key === key)) points.push({ key, lat: Number(g.lat), lon: Number(g.lon) });
    pointOf[g.outlet_id] = key;
  }
  const wx = await weather(points, addDays(days[0], -14), days[days.length - 1], today);

  // the other modules (each optional: a module that can't be read just adds nothing)
  const opsFacts = await otherModules(env, ids2, days[0], to);

  const results = await Promise.all(list.map(async (e) => {
    const outlet = outlets[e.outlet_id] || { code: '?', name: '', country: 'MY' };
    const facts = {
      calendar: calendarFacts(e.business_date, { country: outlet.country || 'MY', state: outlet.state }),
      weather: weatherFacts(wx[pointOf[e.outlet_id]], e.business_date),
      promotions: promos.filter((p) => p.starts <= e.business_date && e.business_date <= p.ends
        && (!p.regions?.length || p.regions.includes(outlet.region)) && (!p.outlet_ids?.length || p.outlet_ids.includes(e.outlet_id)))
        .map((p) => ({ name: p.name, by: p.source === 'competitor' ? 'competitor' : p.source === 'us_pizza' ? 'US Pizza' : 'other', from: p.starts, to: p.ends })),
      outlet: outletFacts(e, salesBy, voidBy, voidCovered),
      others: peerFacts(e, outlets, salesBy, voidBy, voidCovered, excByDay),
      ops: opsFacts(e.outlet_id, e.business_date),
    };
    if (!facts.weather) delete facts.weather;
    if (!facts.promotions.length) facts.promotions = 'none recorded';
    let answer = null;
    let source = 'ai';
    try {
      if (!env.AI) throw new Error('AI binding missing');
      const out = await env.AI.run(env.CAUSES_MODEL || AI_MODEL, { messages: buildMessages(e, outlet, facts), temperature: 0.2, max_tokens: 700 });
      const text = out?.choices?.[0]?.message?.content ?? out?.response ?? '';
      answer = parseCauses(typeof text === 'string' ? text : JSON.stringify(text));
      if (!answer) throw new Error('unreadable AI answer');
    } catch (err) {
      console.error('explain AI:', err.message);
      answer = ruleCauses(e, facts);
      source = 'rules';
    }
    return { id: e.id, patch: { causes: answer.causes.map((c) => ({ ...c, source })), cause_tag: answer.tag, context: facts, causes_at: new Date(now).toISOString() } };
  }));
  for (const r of results) await db.patch(`exceptions?id=eq.${r.id}`, r.patch);
  const left = ids?.length ? 0 : (await db.get(`exceptions?select=id&causes_at=is.null&business_date=gte.${addDays(today, -AUTO_DAYS)}&limit=50`)).length;
  return { explained: results.length, by_ai: results.filter((r) => r.patch.causes[0]?.source === 'ai').length, left, ...(wx.error ? { weather_error: wx.error } : {}) };
}

// POS downtime (Uptime Monitor D1, binding UPTIME_DB), open equipment faults (maintenance_tracker), bad reviews
async function otherModules(env, outletIds, from, to) {
  const start = Date.parse(`${from}T00:00:00+08:00`);
  const end = Date.parse(`${to}T00:00:00+08:00`);
  const [down, monitored, faults, reviews] = await Promise.all([
    env.UPTIME_DB
      ? env.UPTIME_DB.prepare(`SELECT outlet_id, station, started_at, ended_at FROM downtime_log WHERE outlet_id IN (${outletIds.map(() => '?').join(',')}) AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)`)
        .bind(...outletIds, end, start).all().then((r) => r.results).catch(() => null)
      : null,
    env.UPTIME_DB
      ? env.UPTIME_DB.prepare(`SELECT DISTINCT outlet_id FROM stations WHERE outlet_id IN (${outletIds.map(() => '?').join(',')})`)
        .bind(...outletIds).all().then((r) => new Set(r.results.map((x) => x.outlet_id))).catch(() => null)
      : null,
    sb(env, { schema: 'maintenance_tracker' }).get(`faults?select=outlet_id,asset_type,urgency,status,reported_at,resolved_at&outlet_id=in.(${outletIds.join(',')})&reported_at=lt.${new Date(end).toISOString()}&or=(resolved_at.is.null,resolved_at.gt.${new Date(start).toISOString()})&status=neq.cancelled`).catch(() => null),
    sb(env, { schema: 'review_watcher' }).get(`reviews?select=outlet_id,rating,review_created_at&outlet_id=in.(${outletIds.join(',')})&rating=lte.2&review_created_at=gte.${new Date(start).toISOString()}&review_created_at=lt.${new Date(end).toISOString()}`).catch(() => null),
  ]);
  return (outletId, day) => {
    const a = Date.parse(`${day}T00:00:00+08:00`);
    const b = a + 864e5;
    const f = {};
    if (monitored) {
      if (!monitored.has(outletId)) f.pos_monitoring = 'no Uptime Monitor agent at this outlet yet (downtime unknown)';
      else {
        const mins = (down || []).filter((x) => x.outlet_id === outletId).reduce((m, x) => m + Math.max(0, Math.min(x.ended_at || b, b) - Math.max(x.started_at, a)) / 6e4, 0);
        f.pos_downtime_minutes = Math.round(mins);
      }
    }
    if (faults) {
      const open = faults.filter((x) => x.outlet_id === outletId && Date.parse(x.reported_at) < b && (!x.resolved_at || Date.parse(x.resolved_at) > a));
      f.open_faults = open.map((x) => ({ asset: x.asset_type, urgency: x.urgency, status: x.status }));
    }
    if (reviews) f.bad_reviews_that_day = reviews.filter((x) => x.outlet_id === outletId && Date.parse(x.review_created_at) >= a && Date.parse(x.review_created_at) < b).length;
    return f;
  };
}
