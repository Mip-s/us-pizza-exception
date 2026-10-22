// Exception Agent — Cloudflare Worker (mounted in the Operations hub at /exception, which forwards /exception/* here).
//
// Operations upload the Codemax/FeedMe "Sales Summary Listing" each day on the board. The Worker keeps each outlet's
// daily sales (Supabase schema exception_agent) and flags days far below what was expected for that outlet and day:
// expected = Chronos-2 on Modal (MODAL_URL), the weekday baseline when the model can't answer.
//
//   GET  /api/health
//   GET  /api/data?days=35         outlets, exceptions, daily sales for the signed-in person's outlets
//   POST /api/import               the uploaded rows (operations)                      -> detect_days
//   POST /api/detect {days}        find exceptions on those days (max 7 per call; operations)
//   POST /api/notify               push the new exceptions to operations + area managers (operations)
//   POST /api/alias {name, outlet_id}   link (or, outlet_id null, ignore) a report outlet name that didn't match (operations)
//   POST /api/delete {from, to}    remove uploaded sales + open exceptions for those days (operations)
//   POST /api/exceptions/:id {status, note}   acknowledge / resolve / reopen
//   everything else                the board (./dist)
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY, EXCEPTION_API_KEY (= the Modal secret exception-api-key)

import { who, json } from './auth.js';
import { handleData, handleUpdate } from './api.js';
import { handleImport, handleAlias, handleDelete, HttpError } from './import.js';
import { runDetect } from './detect.js';
import { runNotify } from './notify.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/exception' || url.pathname.startsWith('/exception/')) {
      url.pathname = url.pathname.slice('/exception'.length) || '/';
      request = new Request(url, request);
    }
    const { pathname } = url;
    if (pathname === '/api/health') return json({ ok: true });
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      const w = await who(request, env);
      if (w instanceof Response) return w;
      if (pathname === '/api/data' && request.method === 'GET') return await handleData(request, env, w);
      const m = pathname.match(/^\/api\/exceptions\/(\d+)$/);
      if (m && request.method === 'POST') return await handleUpdate(request, env, w, m[1]);

      if (request.method !== 'POST') return json({ error: 'not found' }, 404);
      const opsOnly = ['/api/import', '/api/detect', '/api/notify', '/api/alias', '/api/delete'];
      if (opsOnly.includes(pathname) && !w.isOps) return json({ error: 'operations team only' }, 403);
      const body = await request.json().catch(() => ({}));
      if (pathname === '/api/import') return json({ ok: true, ...(await handleImport(body, w.user, env)) });
      if (pathname === '/api/detect') {
        const r = await runDetect(env, Array.isArray(body.days) ? body.days : []);
        console.log('detect:', JSON.stringify(r));
        return json({ ok: true, ...r });
      }
      if (pathname === '/api/notify') {
        const r = await runNotify(env);
        console.log('notify:', JSON.stringify(r));
        return json({ ok: true, ...r });
      }
      if (pathname === '/api/alias') return json({ ok: true, ...(await handleAlias(body, env)) });
      if (pathname === '/api/delete') {
        const r = await handleDelete(body, env);
        console.log('delete:', JSON.stringify(r));
        return json({ ok: true, ...r });
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(`${pathname} failed:`, err.stack || err.message);
      return json({ error: err.message }, 500);
    }
  },
};
