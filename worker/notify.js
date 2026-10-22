// POST /api/notify — after an upload and its detection: one ranked summary push per person (most RM at stake first)
// for the exceptions not pushed yet
// (only days from the last NOTIFY_RECENT_DAYS; older back-filled days were marked as notified by detect.js).
//   operations team -> every outlet's exceptions (HOD)
//   area manager    -> the exceptions of their outlets
// Every message is also saved to the hub's notification centre (public.notifications, module 'exception').
// Cloudflare's request cap: pushes cost one request per device; anyone over the budget gets the notification-centre
// entry only (never a second push for the same exceptions).

import { sb, sbPublic } from './supabase.js';
import { pushSender } from './push.js';
import { summary } from './messages.js';

const BUDGET = 40; // requests this run may spend on pushes (cap is 50; the rest is reads / writes)

export async function runNotify(env) {
  const db = sb(env);
  const pub = sbPublic(env);
  const pending = await db.get('exceptions?select=id,outlet_id,business_date,kind,net_sales,expected,pct_of_expected,value,usual,impact,bills,cause_tag,causes_i18n&notified_at=is.null&status=eq.open&order=impact.desc.nullslast');
  if (!pending.length) return { people: 0, delivered: 0, skipped: 0 };

  const ids = [...new Set(pending.map((e) => e.outlet_id))].join(',');
  const [outlets, ops, ams] = await Promise.all([
    pub.get(`outlets?select=outlet_id,code,name,area_manager_id&outlet_id=in.(${ids})`),
    pub.get('profiles?select=user_id,preferred_language&role=eq.operations_team'),
    pub.get('area_managers?select=id,user_id'),
  ]);
  const outletBy = Object.fromEntries(outlets.map((o) => [o.outlet_id, o]));
  const amUser = Object.fromEntries(ams.map((a) => [a.id, a.user_id]));
  const list = pending.map((e) => ({ ...e, code: outletBy[e.outlet_id]?.code || '?', name: outletBy[e.outlet_id]?.name || '' }));

  // who gets which exceptions
  const people = new Map(); // user_id -> { lang, items }
  for (const p of ops) people.set(p.user_id, { lang: p.preferred_language, items: list });
  const opsIds = new Set(ops.map((p) => p.user_id));
  const amIds = new Set();
  for (const e of list) {
    const uid = amUser[outletBy[e.outlet_id]?.area_manager_id];
    if (!uid || opsIds.has(uid)) continue; // operations already get every outlet
    if (!people.has(uid)) people.set(uid, { lang: null, items: [] });
    people.get(uid).items.push(e);
    amIds.add(uid);
  }
  if (amIds.size) {
    const langs = await pub.get(`profiles?select=user_id,preferred_language&user_id=in.(${[...amIds].join(',')})`);
    for (const l of langs) if (people.has(l.user_id)) people.get(l.user_id).lang = l.preferred_language;
  }

  const send = pushSender();
  await send.load(env);
  let spent = 0;
  let delivered = 0;
  const notes = [];
  let skipped = 0;
  for (const [uid, p] of people) {
    const cost = send.devices(uid);
    if (spent + cost > BUDGET) {
      skipped += 1; // over this run's request cap: listed in the notification centre, not pushed (never twice)
      const msg = summary(p.items, p.lang);
      notes.push({ user_id: uid, module: 'exception', category: 'daily', title: msg.title, body: msg.body, url: '/exception', outlet_id: null, delivered: false });
      continue;
    }
    const msg = summary(p.items, p.lang);
    const one = new Set(p.items.map((e) => e.code)).size === 1;
    const url = one ? `/exception?q=${encodeURIComponent(p.items[0].code)}` : '/exception';
    const n = await send(env, uid, { ...msg, tag: 'exception-daily', urgency: 'high', url });
    spent += cost;
    delivered += n ? 1 : 0;
    notes.push({ user_id: uid, module: 'exception', category: 'daily', title: msg.title, body: msg.body, url,
      outlet_id: one ? p.items[0].outlet_id : null, delivered: n > 0 });
  }
  if (notes.length) await pub.insert('notifications', notes).catch((err) => console.error('notification centre:', err.message));
  await db.patch(`exceptions?id=in.(${pending.map((e) => e.id).join(',')})`, { notified_at: new Date().toISOString() });
  await send.cleanup(env);
  return { people: people.size, delivered, skipped };
}
