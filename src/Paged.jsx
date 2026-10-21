// Collapsible card section with a paged list (10 per page by default; the viewer can pick 10/25/50/100/All).
// Collapsed / expanded and the per-page choice are remembered per section, per browser.
//   <PagedSection id="grn-offenders" title="Repeat offenders" items={rows} note="…" className="offenders-card">
//     {(shown) => <table>…{shown.map(…)}…</table>}
//   </PagedSection>
// Optional: actions (header controls), top (filters / messages above the list), anchor (section id; a link to
// #anchor opens it even if collapsed), loading (shows Loading… instead of the empty text),
// showCount (default true: the red count bubble — turn off for lists where the number isn't "things to act on").
import { useEffect, useState } from 'react';
import { t } from './i18n.js';

const KEY = (id) => `section.${id}.open`;
const SIZE_KEY = (id) => `section.${id}.perPage`;
export const PAGE_SIZES = [10, 25, 50, 100, 0]; // 0 = all on one page

export function PagedSection({ id, title, items, note, actions = null, top = null, anchor, loading = false, showCount = true, pageSize = 10, defaultOpen = true, className = '', empty = null, children }) {
  const [open, setOpen] = useState(() => {
    if (anchor && typeof window !== 'undefined' && window.location.hash === `#${anchor}`) return true;
    try {
      const v = localStorage.getItem(KEY(id));
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(() => {
    try {
      const v = localStorage.getItem(SIZE_KEY(id));
      return v !== null && PAGE_SIZES.includes(Number(v)) ? Number(v) : pageSize;
    } catch {
      return pageSize;
    }
  });
  const changeSize = (v) => {
    setSize(v);
    setPage(0);
    try { localStorage.setItem(SIZE_KEY(id), String(v)); } catch { /* private mode */ }
  };
  // a search / filter that changes the list goes back to page 1
  useEffect(() => setPage(0), [items.length]);
  const per = size === 0 ? Math.max(1, items.length) : size;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const pg = Math.min(page, pages - 1); // the list can shrink on refresh
  const shown = items.slice(pg * per, (pg + 1) * per);
  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { localStorage.setItem(KEY(id), v ? '1' : '0'); } catch { /* private mode: just don't remember */ }
  };

  return (
    <section className={`card paged-section ${className}`} id={anchor}>
      <div className="card-head paged-head">
        <h2>
          <button type="button" className="paged-toggle" aria-expanded={open} aria-controls={`paged-${id}`} onClick={toggle}>
            <span className="paged-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
            {title}
            {showCount && items.length > 0 && <span className="paged-count">{items.length}</span>}
          </button>
        </h2>
        {open && note && <span className="muted small">{note}</span>}
        {open && actions}
        <button type="button" className="paged-hint" onClick={toggle} aria-hidden="true" tabIndex={-1}>{open ? t('Hide') : t('Show')}</button>
      </div>
      {open && (
        <div id={`paged-${id}`}>
          {top}
          {loading ? <p className="muted">{t('Loading…')}</p> : items.length === 0 ? empty : children(shown)}
          {!loading && items.length > PAGE_SIZES[0] && (
            <nav className="paged-pager" aria-label={t('{title} pages', { title })}>
              <span className="muted">{t('{from}–{to} of {n}', { from: pg * per + 1, to: Math.min((pg + 1) * per, items.length), n: items.length })}</span>
              <label className="paged-size muted">
                {t('Per page')}
                <select value={size} onChange={(e) => changeSize(Number(e.target.value))}>
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n === 0 ? t('All') : n}</option>)}
                </select>
              </label>
              {pages > 1 && (
                <span className="paged-btns">
                  <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)}>{t('← Prev')}</button>
                  <span className="paged-page">{t('Page {p} of {n}', { p: pg + 1, n: pages })}</span>
                  <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>{t('Next →')}</button>
                </span>
              )}
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
