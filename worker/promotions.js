// Promotions calendar (operations): US Pizza promotions and notable competitor ones, so
// the board can show what was running when an outlet was flagged.
import { sb } from './supabase.js';
import { HttpError } from './import.js';

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function addPromotion(env, body, user) {
  const name = String(body?.name || '').trim().slice(0, 160);
  const source = ['us_pizza', 'competitor', 'other'].includes(body?.source) ? body.source : 'us_pizza';
  const { starts, ends } = body || {};
  if (!name || !isDate(starts) || !isDate(ends) || ends < starts) throw new HttpError(400, 'name, start and end dates needed');
  const regions = Array.isArray(body.regions) ? body.regions.map(String).slice(0, 20) : [];
  const [row] = await sb(env).insertReturning('promotions', [{
    name, source, starts, ends, regions, note: String(body.note || '').trim().slice(0, 300) || null, created_by: user.email || user.id,
  }]);
  return { id: row.id };
}

export async function deletePromotion(env, id) {
  const [p] = await sb(env).get(`promotions?select=id&id=eq.${Number(id)}`);
  if (!p) throw new HttpError(404, 'not found');
  await sb(env).del(`promotions?id=eq.${Number(id)}`);
  return { deleted: Number(id) };
}
