// Minimal Supabase REST (PostgREST) client using the service key. Default schema: exception_agent.

export function sb(env, { schema = 'exception_agent' } = {}) {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers = (extra = {}) => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Accept-Profile': schema,
    'Content-Profile': schema,
    ...extra,
  });

  async function call(method, path, body, extra) {
    const res = await fetch(`${base}/${path}`, {
      method,
      headers: headers({ 'Content-Type': 'application/json', ...extra }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    get: (path) => call('GET', path),
    // every row of a query, 1000 at a time (PostgREST's row cap) — one request per 1000 rows
    async all(path, pageSize = 1000) {
      const out = [];
      for (let from = 0; ; from += pageSize) {
        const rows = await call('GET', path, undefined, { Range: `${from}-${from + pageSize - 1}` });
        out.push(...rows);
        if (rows.length < pageSize) return out;
      }
    },
    rpc: (fn, args = {}) => call('POST', `rpc/${fn}`, args),
    insert: (table, rows) => call('POST', table, rows, { Prefer: 'return=minimal' }),
    insertReturning: (table, rows) => call('POST', table, rows, { Prefer: 'return=representation' }),
    upsert: (table, rows, onConflict, { ignore = false } = {}) =>
      call('POST', `${table}?on_conflict=${onConflict}`, rows, {
        Prefer: `return=minimal,resolution=${ignore ? 'ignore-duplicates' : 'merge-duplicates'}`,
      }),
    patch: (path, body) => call('PATCH', path, body, { Prefer: 'return=minimal' }),
    del: (path) => call('DELETE', path, undefined, { Prefer: 'return=minimal' }),
  };
}

export const sbPublic = (env) => sb(env, { schema: 'public' });
