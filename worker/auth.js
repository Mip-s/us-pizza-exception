// Who is asking, and which outlets they may see.
// The board sends the signed-in user's Supabase access token. Their outlets are read WITH THEIR TOKEN (row-level
// security on public.outlets: operations = all, area / outlet managers = their own), only outlets the hub monitors
// (no franchises, no MFM). Everything else in this Worker is read with the service key and filtered to these outlets.

export const ROLES = ['operations_team', 'area_manager', 'outlet_manager'];

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function who(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);
  const userHeaders = { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth };
  const uRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: userHeaders });
  if (!uRes.ok) return json({ error: uRes.status === 401 || uRes.status === 403 ? 'signed out' : 'could not check your account' }, uRes.status === 401 || uRes.status === 403 ? 401 : 502);
  const user = await uRes.json();
  const [pRes, oRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=full_name,role,preferred_language&user_id=eq.${user.id}`, { headers: userHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/outlets?select=outlet_id,code,name,region,area_manager_id&monitored=is.true&order=code`, { headers: userHeaders }),
  ]);
  if (!pRes.ok || !oRes.ok) return json({ error: 'could not check your account' }, 502);
  const [profile] = await pRes.json();
  if (!profile || !ROLES.includes(profile.role)) return json({ error: 'no access' }, 403);
  const outlets = await oRes.json();
  return { user, profile, outlets, isOps: profile.role === 'operations_team' };
}
