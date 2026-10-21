import { createClient } from '@supabase/supabase-js';

// Public values only (same project + key as the hub, so the hub login is shared on the same site).
export const supabase = createClient(
  'https://yqigynppqmhmsohwrdof.supabase.co',
  'sb_publishable_uYlMQegmT74Y3IgEf8E7wg_pA2fPBjq'
);

export const HUB_URL = 'https://us-pizza-operations.fazdagroll.workers.dev/';

// Signing out also takes THIS device off the signed-out person's alerts (same helper in the hub and every module).
export async function signOutHere() {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await Promise.race([
        supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  } catch {
    /* couldn't tidy up the alerts: still sign out */
  }
  return supabase.auth.signOut({ scope: 'local' });
}
