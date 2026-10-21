// Codemax/FeedMe "Sales Summary Listing" export -> one row per outlet per business day (pure; test/importers.test.mjs).
//
// Layout of the report (one sheet):
//   Sales Summary Listing
//   Filters: ((Business Date from 1/9/2026 to 30/9/2026) or ...)
//   [blank] | Business Date | Gross Amount Excl. | Discount | Net Sales | Tax | ... | Trans. Count | Guest Count
//   Outlet: 001-US Pizza Kelana Jaya
//   [blank] | 2026-09-01 | 2097.02 | 434.98 | 1662.04 | ...
//   [blank] | Subtotal | ...
// Recognised by its column headings, not its file name.

const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const pad = (n) => String(n).padStart(2, '0');

// a Date (read-excel-file), 'dd/mm/yyyy' or 'yyyy-mm-dd' -> 'yyyy-mm-dd'
export function ymd(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel dates come in as UTC midnight
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const s = clean(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const number = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(clean(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const HEAD = ['Business Date', 'Net Sales'];

export function parseSalesSummary(rows) {
  const h = rows.findIndex((r) => HEAD.every((x) => r.some((c) => clean(c) === x)));
  if (h < 0) return null;
  const header = rows[h].map(clean);
  const col = (name) => header.indexOf(name);
  const c = { date: col('Business Date'), gross: col('Gross Amount Excl.'), discount: col('Discount'), net: col('Net Sales'), bills: col('Trans. Count'), guests: col('Guest Count') };

  // "Filters: ((Business Date from 1/9/2026 to 30/9/2026) ..."
  let from = null;
  let to = null;
  for (const r of rows.slice(0, h)) {
    const m = clean(r[0]).match(/Business Date from (\d{1,2}\/\d{1,2}\/\d{4}) to (\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) [from, to] = [ymd(m[1]), ymd(m[2])];
  }

  const out = [];
  let outlet = null;
  for (const r of rows.slice(h + 1)) {
    const first = clean(r[0]);
    if (first.startsWith('Outlet:')) {
      outlet = first.slice('Outlet:'.length).trim();
      continue;
    }
    if (!outlet) continue;
    const date = ymd(r[c.date]);
    if (!date) continue; // Subtotal / Grand Total
    const net = number(r[c.net]);
    if (net == null) continue;
    out.push({
      name: outlet, date, net,
      gross: c.gross >= 0 ? number(r[c.gross]) : null,
      discount: c.discount >= 0 ? number(r[c.discount]) : null,
      bills: c.bills >= 0 ? number(r[c.bills]) : null,
      guests: c.guests >= 0 ? number(r[c.guests]) : null,
    });
  }
  const dates = out.map((r) => r.date).sort();
  return {
    rows: out,
    from: from || dates[0] || null,
    to: to || dates[dates.length - 1] || null,
    stats: { rows: out.length, outlets: new Set(out.map((r) => r.name)).size },
  };
}

// every sheet of a workbook ([{ sheet, data }]) -> { result } | { error: 'unknown' }
export function readWorkbook(sheets) {
  for (const s of sheets) {
    const r = parseSalesSummary(s.data);
    if (r && r.rows.length) return { result: r };
  }
  return { error: 'unknown' };
}
