// Web Push — same VAPID keys and push_subscriptions as every other module, so alerts arrive in the Operations hub app.
// (Copy of the GRN Chaser's sender; default tap target /exception.)

import { buildPushPayload } from '@block65/webcrypto-web-push';
import { sbPublic } from './supabase.js';

// One sender per run: loads every push subscription ONCE (one request); each message then costs one request per device
// (Cloudflare caps a Worker run at 50 requests on the free plan). send(env, userId, msg) -> devices reached.
export function pushSender() {
  let subsBy = null;
  const dead = new Set();
  const load = async (env) => {
    if (subsBy) return;
    subsBy = {};
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;
    for (const s of await sbPublic(env).get('push_subscriptions?select=user_id,endpoint,p256dh,auth')) (subsBy[s.user_id] ||= []).push(s);
  };
  const send = async (env, userId, msg) => {
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return 0;
    await load(env);
    return pushTo(env, subsBy[userId] || [], msg, dead);
  };
  send.load = load;
  send.devices = (userId) => (subsBy ? (subsBy[userId] || []).length : 1);
  send.cleanup = async (env) => {
    if (!dead.size) return 0;
    const list = [...dead].map((e) => `"${encodeURIComponent(e)}"`).join(',');
    try {
      await sbPublic(env).del(`push_subscriptions?endpoint=in.(${list})`);
    } catch (err) {
      console.error('removing dead push subscriptions failed:', err.message);
      return 0;
    }
    return dead.size;
  };
  return send;
}

async function pushTo(env, subs, { title, body, tag, urgency = 'normal', url = '/exception' }, dead = null) {
  if (!subs.length) return 0;
  const data = JSON.stringify({ title, body, tag, url });
  const vapid = { subject: env.VAPID_SUBJECT || 'mailto:admin@uspizza.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        const payload = await buildPushPayload(
          { data, options: { ttl: 12 * 3600, urgency } },
          { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
          vapid
        );
        const res = await fetch(s.endpoint, payload);
        if (res.ok) sent += 1;
        else {
          if ((res.status === 404 || res.status === 410) && dead) dead.add(s.endpoint);
          console.warn('push rejected', res.status, (await res.text()).slice(0, 120));
        }
      } catch (err) {
        console.error('push error', err.message);
      }
    })
  );
  return sent;
}
