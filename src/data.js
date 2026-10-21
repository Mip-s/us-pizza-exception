// Talking to the Exception Agent Worker (/exception/api/*) with the signed-in user's token.
import { supabase } from './supabase.js';

export const ROLES = ['operations_team', 'area_manager', 'outlet_manager'];
export const localDate = (ms = Date.now()) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);

async function call(path, payload, method = payload ? 'POST' : 'GET') {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
    method,
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const loadAll = (days = 35) => call(`data?days=${days}`);
export const importSales = (payload) => call('import', payload);
export const updateException = (id, status, note) => call(`exceptions/${id}`, { status, note });
export const linkName = (name, outletId) => call('alias', { name, outlet_id: outletId });
export const notify = () => call('notify', {});

// Check the uploaded days, 7 at a time (one Worker call each; the first may wait ~1 min while the model wakes up).
// onProgress(done, total) -> totals
export async function detectAll(days, onProgress = () => {}) {
  const total = { checked: 0, flagged: 0, removed: 0, method: 'chronos2', model_error: null };
  for (let i = 0; i < days.length; i += 7) {
    onProgress(i, days.length);
    const r = await call('detect', { days: days.slice(i, i + 7) });
    total.checked += r.checked || 0;
    total.flagged += r.flagged || 0;
    total.removed += r.removed || 0;
    if (r.method === 'baseline') total.method = 'baseline';
    if (r.model_error) total.model_error = r.model_error;
  }
  onProgress(days.length, days.length);
  return total;
}
