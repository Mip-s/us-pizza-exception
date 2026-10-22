// Exception Agent rules — pure functions (tested in test/rules.test.mjs).

export const FLAG_BELOW = 0.5; // a day below half of what was expected for that outlet and day = exception
export const MIN_EXPECTED = 300; // RM: below this the "expected" is too small to judge (new / tiny outlet)
export const CHRONOS_MIN_DAYS = 14; // days of history Chronos-2 needs for an outlet; fewer -> weekday baseline
export const BASELINE_MIN_DAYS = 7; // fewer than this -> not judged at all
export const HISTORY_DAYS = 90; // history sent to the model
export const MAX_GAP_DAYS = 14; // last sale older than this before the day -> weekday baseline
export const NOTIFY_RECENT_DAYS = 3; // exceptions older than this (back-filling a month) are listed, not pushed
export const DETECT_PER_CALL = 7; // days checked per /api/detect request (one Modal call each; Worker request cap)

// Discount and void spikes: each outlet against its own last TRAIL_DAYS days (median + robust spread).
// Tuned on Mar-Oct 2026 data: about one discount and one void outlet-day a day across the chain.
export const TRAIL_DAYS = 28;
export const TRAIL_MIN = 10; // fewer days of history -> not judged
export const DISCOUNT_PP = 0.10; // discount share at least 10 percentage points above the outlet's usual
export const DISCOUNT_Z = 4; //   ... and 4 robust spreads above it
export const DISCOUNT_MIN_RM = 150; // ... and at least RM150 more discount than usual
export const VOID_MULT = 3; // voids at least 3x the outlet's usual day
export const VOID_Z = 5; //   ... and 5 robust spreads above it
export const VOID_MIN_RM = 200; // ... and at least RM200 voided
export const VOID_SHARE = 0.10; // ... and at least 10% of that day's sales
export const CRIT_RM = 500; // RM at stake from which an exception shows red
const DAY = 86400e3;

export const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d, n) => ymd(Date.parse(`${d}T00:00:00Z`) + n * DAY);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const todayMYT = (now = Date.now()) => ymd(now + 8 * 3600e3);
export const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

// Outlet names as the report prints them: "001-US Pizza Kelana Jaya", "055-US Pizza Lucernce Square, Penang",
// "SG03-US Pizza - West Coast Plaza". The code in front is NOT the hub's code -> compare names only.
export const nameKey = (s) =>
  String(s || '')
    .replace(/^\s*[\w]+-(?=\s*\S)/, '') // the report's own code
    .toLowerCase()
    .replace(/^\s*us\s*pizza\s*-?\s*/, '')
    .replace(/[^a-z0-9]/g, '');

export const isMfm = (s) => /^\s*\w+M-|manhattan/i.test(String(s || ''));

// report name -> { outlet_id, learnt } | { ignored: true } | null. aliases: { name_key: outlet_id | null (= ignored) };
// outlets: [{ outlet_id, name }]. 1) a saved alias (or ignore), 2) the same name, 3) one outlet whose name contains it (or the other way round) — only if unique
export function resolver(outlets, aliases) {
  const exact = {};
  for (const o of outlets) exact[nameKey(o.name)] ??= o.outlet_id;
  const keys = Object.keys(exact).filter((k) => k.length >= 4);
  return (reportName) => {
    const k = nameKey(reportName);
    if (!k) return null;
    if (Object.hasOwn(aliases, k)) return aliases[k] ? { outlet_id: aliases[k], learnt: false } : { ignored: true };
    if (exact[k]) return { outlet_id: exact[k], learnt: true };
    const hits = [...new Set(keys.filter((x) => k.length >= 4 && (x.includes(k) || k.includes(x))).map((x) => exact[x]))];
    return hits.length === 1 ? { outlet_id: hits[0], learnt: true } : null;
  };
}

// Fallback expectation ("B"): the outlet's median day x how all outlets move on that weekday (log scale).
// hist: [{ outlet_id, business_date, net }] (net > 0). -> (outlet_id, day) => expected | null
export function weekdayBaseline(hist) {
  const by = {};
  for (const r of hist) if (r.net > 0) (by[r.outlet_id] ||= []).push(r);
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const lvl = {};
  for (const [o, rows] of Object.entries(by)) lvl[o] = median(rows.map((r) => Math.log(r.net)));
  const devs = {};
  for (const r of hist) if (r.net > 0 && lvl[r.outlet_id] != null) (devs[weekday(r.business_date)] ||= []).push(Math.log(r.net) - lvl[r.outlet_id]);
  const dowf = Object.fromEntries(Object.entries(devs).map(([d, a]) => [d, median(a)]));
  return (outletId, day) => (lvl[outletId] == null ? null : Math.exp(lvl[outletId] + (dowf[weekday(day)] || 0)));
}

// median and robust spread (1.4826 x median absolute deviation) of a list of numbers
export function robust(values) {
  const s = [...values].sort((a, b) => a - b);
  const med = (a) => (a.length % 2 ? a[a.length >> 1] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const m = med(s);
  return { median: m, spread: 1.4826 * med(values.map((v) => Math.abs(v - m)).sort((a, b) => a - b)) };
}

// Discount spike. day: { gross, discount }; hist: [{ gross, discount }] (the outlet's days before, gross > 0)
// -> { kind, value (discount % today), usual (% usually), impact (RM of discount above usual) } | null
export function judgeDiscount(day, hist) {
  const g = Number(day?.gross);
  if (!(g > 0) || hist.length < TRAIL_MIN) return null;
  const { median, spread } = robust(hist.map((h) => Number(h.discount) / Number(h.gross)));
  const share = Number(day.discount) / g;
  const excess = (share - median) * g;
  if (share - median < DISCOUNT_PP || (share - median) / Math.max(spread, 0.02) < DISCOUNT_Z || excess < DISCOUNT_MIN_RM) return null;
  return { kind: 'discount_spike', value: Math.round(share * 100), usual: Math.round(median * 100), impact: Math.round(excess) };
}

// Void spike. voids: RM voided today (0 if none); hist: RM voided on each of the outlet's days before (0 = none);
// sales: today's net sales -> { kind, value (RM voided), usual (RM usually), impact (RM above usual) } | null
export function judgeVoids(voids, hist, sales) {
  if (hist.length < TRAIL_MIN) return null;
  const v = Math.max(Number(voids) || 0, 0);
  const { median, spread } = robust(hist.map((x) => Math.max(Number(x) || 0, 0)));
  if (v < VOID_MIN_RM || v < VOID_MULT * Math.max(median, 1) || (v - median) / Math.max(spread, 20) < VOID_Z) return null;
  if (!(Number(sales) > 0) || v / Number(sales) < VOID_SHARE) return null;
  return { kind: 'void_spike', value: Math.round(v), usual: Math.round(median), impact: Math.round(v - median) };
}

// Decide one outlet-day. sale: { net, bills } | null (no row that day); exp: { expected, low, high, method } | null
export function judge(sale, exp) {
  if (!exp || !(exp.expected >= MIN_EXPECTED)) return null;
  if (!sale) return { kind: 'no_sales', net_sales: 0, pct_of_expected: 0 };
  if (sale.net < FLAG_BELOW * exp.expected) {
    return { kind: 'sales_drop', net_sales: sale.net, pct_of_expected: Math.round((100 * sale.net) / exp.expected) };
  }
  return null;
}

// The days of an upload worth checking: every business day in the file, newest first, not older than maxAgeDays
export function detectDays(dates, today, maxAgeDays = 35) {
  const from = addDays(today, -maxAgeDays);
  return [...new Set(dates)].filter((d) => d >= from && d < today).sort().reverse();
}
