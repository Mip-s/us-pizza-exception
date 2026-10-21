// Board reads / writes. Everything is scoped to the outlets the signed-in person may see (auth.who).

import { sb } from './supabase.js';
import { json } from './auth.js';
import { addDays, todayMYT } from './rules.js';

// GET /api/data?days=35 -> outlets, exceptions, daily sales of the last `days` days, last upload
export async function handleData(request, env, who) {
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 35, 7), 92);
  const from = addDays(todayMYT(), -days);
  const ids = who.outlets.map((o) => o.outlet_id);
  const db = sb(env);
  const scope = ids.length ? `outlet_id=in.(${ids.join(',')})` : 'outlet_id=is.null';
  const [exceptions, sales, batches] = await Promise.all([
    db.get(`exceptions?select=id,outlet_id,business_date,kind,net_sales,expected,usual_low,usual_high,pct_of_expected,bills,method,same_day,status,note,created_at,resolved_at&${scope}&business_date=gte.${from}&order=business_date.desc,pct_of_expected.asc&limit=2000`),
    db.all(`daily_sales?select=outlet_id,business_date,net,bills&${scope}&business_date=gte.${from}&order=business_date`),
    db.get('import_batches?select=id,file_name,date_from,date_to,row_count,outlets,imported_by,imported_at,unmatched,skipped&order=imported_at.desc&limit=5'),
  ]);
  return json({
    profile: who.profile,
    is_ops: who.isOps,
    outlets: who.outlets.map(({ outlet_id, code, name, region }) => ({ outlet_id, code, name, region })),
    exceptions,
    sales,
    // upload history (who / which file) for operations; everyone sees how fresh the data is
    uploads: who.isOps ? batches : batches.slice(0, 1).map(({ date_from, date_to, imported_at }) => ({ date_from, date_to, imported_at })),
    days,
    generated_at: Date.now(),
  });
}

// POST /api/exceptions/:id { status: 'acknowledged' | 'resolved' | 'open', note }
export async function handleUpdate(request, env, who, id) {
  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (!['acknowledged', 'resolved', 'open'].includes(status)) return json({ error: 'status must be acknowledged, resolved or open' }, 400);
  const db = sb(env);
  const [e] = await db.get(`exceptions?select=id,outlet_id,note&id=eq.${id}`);
  if (!e || !who.outlets.some((o) => o.outlet_id === e.outlet_id)) return json({ error: 'not found' }, 404);
  const patch = { status, updated_at: new Date().toISOString(), resolved_at: status === 'resolved' ? new Date().toISOString() : null, resolved_by: status === 'resolved' ? who.user.id : null };
  const note = String(body.note || '').trim().slice(0, 1000);
  if (note) {
    const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const line = `[${stamp}] ${who.profile.full_name || who.user.email}: ${note}`;
    patch.note = e.note ? `${e.note}\n${line}` : line;
  }
  await db.patch(`exceptions?id=eq.${id}`, patch);
  return json({ ok: true });
}
