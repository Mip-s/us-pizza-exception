// POST /api/import — operations upload the Codemax/FeedMe "Sales Summary Listing" on the board.
// The page reads the Excel file (src/importers.js) and sends one row per outlet per business day:
//   { file_name, date_from, date_to, rows: [{ name: "001-US Pizza Kelana Jaya", date: "2026-09-01", gross, discount,
//     net, bills, guests }] }
// Each report outlet name is linked to a hub outlet by NAME (rules.resolver; the report's codes are not the hub's).
// MFM, franchises and anything the hub doesn't monitor are skipped. Re-uploading a day replaces it.
// -> { batch_id, rows, outlets, unmatched, skipped, detect_days }  (the board then calls /api/detect for detect_days)

import { sb, sbPublic } from './supabase.js';
import { resolver, nameKey, isMfm, detectDays, todayMYT } from './rules.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export async function handleImport(body, user, env) {
  const input = Array.isArray(body?.rows) ? body.rows : [];
  if (!input.length) throw new HttpError(400, 'no sales rows in this file');
  if (input.length > 20000) throw new HttpError(413, 'too many rows — upload a shorter period');

  const db = sb(env);
  const [outlets, aliasRows] = await Promise.all([
    sbPublic(env).get('outlets?select=outlet_id,code,name,monitored'),
    db.get('outlet_aliases?select=name_key,outlet_id'),
  ]);
  const monitored = new Set(outlets.filter((o) => o.monitored).map((o) => o.outlet_id));
  const resolve = resolver(outlets, Object.fromEntries(aliasRows.map((a) => [a.name_key, a.outlet_id])));

  const unmatched = new Set();
  const skipped = new Set();
  const learnt = {};
  const byKey = new Map();
  for (const r of input) {
    if (!isDate(r.date) || num(r.net) == null) continue;
    if (isMfm(r.name)) {
      skipped.add(r.name);
      continue;
    }
    const hit = resolve(r.name);
    if (!hit) {
      unmatched.add(r.name);
      continue;
    }
    if (!monitored.has(hit.outlet_id)) {
      skipped.add(r.name);
      continue;
    }
    if (hit.learnt) learnt[nameKey(r.name)] = hit.outlet_id;
    byKey.set(`${hit.outlet_id}|${r.date}`, {
      outlet_id: hit.outlet_id, business_date: r.date, gross: num(r.gross), discount: num(r.discount), net: num(r.net),
      bills: num(r.bills), guests: num(r.guests), report_name: String(r.name).slice(0, 120),
    });
  }
  const rows = [...byKey.values()];
  const dates = rows.map((r) => r.business_date).sort();

  const [batch] = await db.insertReturning('import_batches', [{
    file_name: String(body.file_name || '').slice(0, 200) || null,
    date_from: isDate(body.date_from) ? body.date_from : dates[0] || null,
    date_to: isDate(body.date_to) ? body.date_to : dates[dates.length - 1] || null,
    row_count: rows.length,
    outlets: new Set(rows.map((r) => r.outlet_id)).size,
    imported_by: user.email || user.id,
    unmatched: [...unmatched].sort(),
    skipped: [...skipped].sort(),
  }]);
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 1000) {
    await db.upsert('daily_sales', rows.slice(i, i + 1000).map((r) => ({ ...r, batch_id: batch.id, updated_at: now })), 'outlet_id,business_date');
  }
  const learntRows = Object.entries(learnt).map(([name_key, outlet_id]) => ({ name_key, outlet_id }));
  if (learntRows.length) await db.upsert('outlet_aliases', learntRows, 'name_key', { ignore: true });

  return {
    batch_id: batch.id,
    rows: rows.length,
    outlets: batch.outlets,
    unmatched: batch.unmatched,
    skipped: batch.skipped,
    detect_days: detectDays(dates, todayMYT()),
  };
}

// POST /api/alias { name, outlet_id } — operations link a report name that didn't match to the right outlet
export async function handleAlias(body, env) {
  const key = nameKey(body?.name);
  if (!key || !/^[0-9a-f-]{36}$/.test(String(body?.outlet_id || ''))) throw new HttpError(400, 'name and outlet_id needed');
  await sb(env).upsert('outlet_aliases', [{ name_key: key, outlet_id: body.outlet_id }], 'name_key');
  return { name_key: key };
}
