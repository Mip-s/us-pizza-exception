// Promotions calendar: US Pizza promotions (and notable competitor ones) by date and region, so everyone can see what
// was running when an outlet was flagged. Operations add / remove; everyone can see them.
import { useState } from 'react';
import { addPromotion, deletePromotion, localDate } from './data.js';
import { PagedSection } from './Paged.jsx';
import { t, locale } from './i18n.js';

const SOURCE = { us_pizza: 'US Pizza', competitor: 'Competitor', other: 'Other' };
const dm = (d) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

export default function Promotions({ promotions, regions, isOps, onChanged }) {
  const [form, setForm] = useState({ name: '', source: 'us_pizza', starts: localDate(), ends: localDate(), regions: [], note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const today = localDate();
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await addPromotion(form);
      setForm((f) => ({ ...f, name: '', note: '', regions: [] }));
      setAdding(false);
      await onChanged(t('Promotion added.'));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (p) => {
    try {
      await deletePromotion(p.id);
      await onChanged(t('Promotion removed.'));
    } catch (e) {
      setErr(e.message);
    }
  };
  const toggleRegion = (r) => setForm((f) => ({ ...f, regions: f.regions.includes(r) ? f.regions.filter((x) => x !== r) : [...f.regions, r] }));

  return (
    <PagedSection id="exc-promos" title={t('Promotions')} items={promotions} showCount={false} defaultOpen={false}
      note={t('US Pizza promotions (and big competitor ones) that change sales or discounts.')}
      actions={isOps && !adding ? <button type="button" className="btn" onClick={() => setAdding(true)}>{t('+ Add promotion')}</button> : null}
      top={isOps && adding ? (
        <div className="promo-form">
          <input type="text" placeholder={t('Promotion name (e.g. Buy 1 Free 1 Regular)')} value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="promo-row">
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label={t('Whose promotion')}>
              {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
            <label>{t('From')} <input type="date" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></label>
            <label>{t('To')} <input type="date" value={form.ends} min={form.starts} onChange={(e) => setForm({ ...form, ends: e.target.value })} /></label>
          </div>
          <div className="promo-regions small">
            <span className="muted">{t('Regions (none ticked = all outlets):')}</span>
            {regions.map((r) => (
              <label key={r}><input type="checkbox" checked={form.regions.includes(r)} onChange={() => toggleRegion(r)} /> {r}</label>
            ))}
          </div>
          <input type="text" placeholder={t('Note (channels, promo code, …)')} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="promo-row">
            <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim() || !form.starts || !form.ends || form.ends < form.starts} onClick={save}>{busy ? t('Working…') : t('Save promotion')}</button>
            <button type="button" className="link-btn" onClick={() => setAdding(false)}>{t('Cancel')}</button>
          </div>
          {err && <div className="error small">{err}</div>}
        </div>
      ) : (err ? <div className="error small">{err}</div> : null)}
      empty={<p className="muted">{t('No promotions recorded.')}</p>}>
      {(shown) => (
        <ul className="promo-list">
          {shown.map((p) => (
            <li key={p.id} className={p.ends < today ? 'is-past' : p.starts > today ? 'is-future' : 'is-live'}>
              <div>
                <strong>{p.name}</strong>
                <div className="small muted">
                  <span className={`promo-src promo-${p.source}`}>{t(SOURCE[p.source] || p.source)}</span>
                  {' '}{dm(p.starts)} – {dm(p.ends)} · {p.regions?.length ? p.regions.join(', ') : t('All outlets')}
                  {p.starts <= today && today <= p.ends && <> · <b>{t('running now')}</b></>}
                  {p.note && <> · {p.note}</>}
                </div>
              </div>
              {isOps && <button type="button" className="link-btn small" onClick={() => remove(p)}>{t('Remove')}</button>}
            </li>
          ))}
        </ul>
      )}
    </PagedSection>
  );
}
