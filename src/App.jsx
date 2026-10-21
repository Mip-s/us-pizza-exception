import { useCallback, useEffect, useMemo, useState } from 'react';
import { PagedSection } from './Paged.jsx';
import { supabase, HUB_URL, signOutHere } from './supabase.js';
import { usePush, useUpdateCheck, usePullToRefresh, PULL_THRESHOLD } from './hooks.js';
import { loadAll, updateException, ROLES } from './data.js';
import LangSelect from './LangSelect.jsx';
import Upload from './Upload.jsx';
import { t, useLang, locale, syncLangFromProfile, LANGUAGE_NAMES } from './i18n.js';

const REFRESH_MS = 2 * 60 * 1000;
const IN_HUB = window.location.pathname.startsWith('/exception');
const hubHome = IN_HUB ? '/' : HUB_URL;
const ROLE = { operations_team: 'Operations Team', area_manager: 'Area Manager', outlet_manager: 'Outlet Manager' };
const shortName = (n = '') => n.replace(/^US Pizza /, '');
const money = (v) => `RM${Math.round(Number(v) || 0).toLocaleString('en-MY')}`;
const dayName = (ymd) => new Date(`${ymd}T00:00:00+08:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
const hm = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dmhm = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const regionName = (r) => r || t('Unassigned');
const KIND = { sales_drop: 'Sales far below normal', no_sales: 'No sales in the report' };
const STATUS = { open: 'Open', acknowledged: 'Looking into it', resolved: 'Resolved' };

export default function App() {
  const [session, setSession] = useState(undefined);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [flash, setFlash] = useState('');
  const [f, setF] = useState(() => ({ region: '', q: new URLSearchParams(window.location.search).get('q') || '' }));
  const push = usePush(session);
  const { updateReady, check: checkForUpdate } = useUpdateCheck();
  useLang();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const d = await loadAll(35);
      syncLangFromProfile(d.profile?.preferred_language);
      setData(d);
      setError('');
    } catch (e) {
      setError(e.status === 401 ? 'signed_out' : e.status === 403 ? 'no_access' : e.message);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return undefined;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [session, load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (await checkForUpdate()) return window.location.reload();
      await load();
    } finally {
      setRefreshing(false);
    }
  };
  const pullDistance = usePullToRefresh(handleRefresh);

  const outletBy = useMemo(() => Object.fromEntries((data?.outlets || []).map((o) => [o.outlet_id, o])), [data]);
  const regions = useMemo(() => [...new Set((data?.outlets || []).map((o) => o.region).filter(Boolean))].sort(), [data]);
  const salesBy = useMemo(() => {
    const m = {};
    for (const s of data?.sales || []) (m[s.outlet_id] ||= []).push(s);
    return m;
  }, [data]);
  const inScope = (outletId) => {
    const o = outletBy[outletId];
    if (!o) return false;
    if (f.region && o.region !== f.region) return false;
    const q = f.q.trim().toLowerCase();
    return !q || `${o.code} ${o.name}`.toLowerCase().includes(q);
  };

  // ---------- gate ----------
  if (session === undefined) return <div className="boot" />;
  const noAccess = error === 'no_access' || (data && !ROLES.includes(data.profile?.role));
  if (!session || error === 'signed_out' || noAccess) {
    return (
      <div className="gate">
        <div className="card gate-card">
          <img src={`${import.meta.env.BASE_URL}logo.jpeg`} alt="US Pizza" className="gate-logo" />
          <div className="eyebrow">{t('Exception Agent')}</div>
          <h1>{noAccess ? t('No access') : t('Please sign in')}</h1>
          <p className="muted">{noAccess ? t("Your account doesn't have access to the Exception Agent.") : t('Sign in to the Operations Hub first, then open the Exception Agent from there.')}</p>
          <a className="btn btn-primary block" href={hubHome}>{t('Go to Operations Hub')}</a>
        </div>
      </div>
    );
  }

  const exceptions = (data?.exceptions || []).filter((e) => inScope(e.outlet_id));
  const open = exceptions.filter((e) => e.status !== 'resolved');
  const resolved = exceptions.filter((e) => e.status === 'resolved');
  const lastDay = (data?.sales || []).reduce((m, s) => (s.business_date > m ? s.business_date : m), '');
  const lastDayFlags = exceptions.filter((e) => e.business_date === lastDay);
  const lastUpload = data?.uploads?.[0];
  const name = data?.profile?.full_name || session.user?.email;
  const pullVisible = pullDistance > 0 || refreshing;
  const role = data?.profile?.role;

  const act = async (e, status, note) => {
    try {
      await updateException(e.id, status, note);
      await load();
    } catch (err) {
      setFlash(t("Couldn't save: {error}", { error: err.message }));
    }
  };

  return (
    <div className="wrap">
      <div className={`pull-indicator ${pullVisible ? 'pull-visible' : ''} ${refreshing ? 'pull-refreshing' : ''}`}
        style={pullDistance > 0 ? { transform: `translate(-50%, ${pullDistance}px)`, transition: 'none' } : undefined} aria-hidden="true">
        <span className="pull-arrow" style={{ transform: `rotate(${refreshing ? 0 : Math.min(pullDistance / PULL_THRESHOLD, 1) * 180}deg)` }}>{refreshing ? '' : '↓'}</span>
        <span>{refreshing ? t('Refreshing…') : pullDistance >= PULL_THRESHOLD ? t('Release to refresh') : t('Pull to refresh')}</span>
      </div>

      <header className="top">
        <div>
          <a className="back" href={hubHome}>{t('← Operations Hub')}</a>
          <div className="eyebrow">{t('Exception Agent')}</div>
          <h1>{t('Sales exceptions')}</h1>
          <p className="muted">{t("Each outlet's daily sales compared with what an AI model (Chronos-2) expected for that outlet and day. A day below half of normal is flagged to the area manager and HOD.")}</p>
        </div>
        <div className="toolbar">
          <button type="button" className="tool" onClick={handleRefresh} disabled={refreshing}>
            <span className={`refresh-icon ${refreshing ? 'spinning' : ''}`} aria-hidden="true">⟳</span>
            {refreshing ? t('Refreshing…') : t('Refresh')}
          </button>
          {(push.supported || push.needsIosInstall) && !push.subscribed && (
            <button type="button" className="tool push-toggle" onClick={push.enable} disabled={push.busy}
              title={push.needsIosInstall ? t('Add to Home Screen first (iOS requirement)') : push.error || undefined}>
              <span className="push-dot" aria-hidden="true" />
              {push.busy ? t('Working…') : push.needsIosInstall ? t('Enable alerts (install first)') : t('Enable alerts')}
            </button>
          )}
          <div className="user-badge">
            <div className="user-avatar" aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</div>
            <div className="user-text">
              <strong>{name}</strong>
              <small>{data ? `${ROLE[role] ? t(ROLE[role]) : role} · ${data.outlets.length === 1 ? t('1 outlet') : t('{n} outlets', { n: data.outlets.length })} · ${LANGUAGE_NAMES[data.profile?.preferred_language] || 'English'}` : t('Signed in')}</small>
            </div>
            <LangSelect />
            <button type="button" className="logout-button" onClick={signOutHere}>{t('Sign out')}</button>
          </div>
        </div>
      </header>

      {push.error && <div className="error">{push.error}</div>}
      {updateReady && (
        <div className="update-banner">
          <span>{t('A new version of the Exception Agent is available.')}</span>
          <button type="button" onClick={() => window.location.reload()}>{t('Update now')}</button>
        </div>
      )}
      {data && <p className="updated muted small">{t('Updated {time}', { time: hm(data.generated_at) })}{lastUpload ? ` · ${t('Sales data up to {day} (uploaded {at})', { day: lastUpload.date_to ? dayName(lastUpload.date_to) : '–', at: dmhm(lastUpload.imported_at) })}` : ''}</p>}
      {error && !['signed_out', 'no_access'].includes(error) && <div className="error">{t("Couldn't load: {error}", { error })}</div>}
      {flash && <div className="flash" role="status"><span>{flash}</span><button type="button" className="link-btn" onClick={() => setFlash('')}>{t('Dismiss')}</button></div>}

      {!data ? (
        <p className="muted">{t('Loading…')}</p>
      ) : (
        <>
          {!lastUpload && (
            <div className="waiting">
              <strong>{t('Waiting for data.')}</strong> {data.is_ops ? t('Upload a Sales Summary Listing below to start.') : t('Operations uploads the daily sales.')}
            </div>
          )}

          <div className="tiles">
            <div className={`tile ${open.length ? 'tile-alert' : ''}`}>
              <span className="tile-label">{t('Needs attention')}</span><span className="tile-value">{open.length}</span>
              <span className="muted small">{t('open exceptions · last {n} days', { n: data.days })}</span>
            </div>
            <div className="tile">
              <span className="tile-label">{t('Latest sales day')}</span><span className="tile-value tile-text">{lastDay ? dayName(lastDay) : '–'}</span>
              <span className="muted small">{lastDay ? (lastDayFlags.length === 1 ? t('1 outlet flagged') : t('{n} outlets flagged', { n: lastDayFlags.length })) : t('no sales uploaded yet')}</span>
            </div>
            <div className="tile">
              <span className="tile-label">{t('Resolved')}</span><span className="tile-value">{resolved.length}</span>
              <span className="muted small">{t('last {n} days', { n: data.days })}</span>
            </div>
          </div>

          {data.outlets.length > 1 && (
            <div className="filters" role="group" aria-label={t('Filters')}>
              {regions.length > 1 && (
                <select value={f.region} onChange={(e) => setF((p) => ({ ...p, region: e.target.value }))} aria-label={t('Region')}>
                  <option value="">{t('All regions')}</option>
                  {regions.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
                </select>
              )}
              <input type="search" placeholder={t('Search outlet name or code')} value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} aria-label={t('Search outlets')} />
            </div>
          )}

          <PagedSection id="exc-open" anchor="needs-attention" title={t('Needs attention')} items={open}
            empty={<p className="muted">{t('Nothing flagged. Every outlet sold at least half of its normal on the days uploaded.')}</p>}>
            {(shown) => <ul className="exc-list">{shown.map((e) => <ExceptionCard key={e.id} e={e} o={outletBy[e.outlet_id]} sales={salesBy[e.outlet_id] || []} onAct={act} />)}</ul>}
          </PagedSection>

          {data.is_ops && <Upload outlets={data.outlets} onImported={async (msg) => { setFlash(msg); await load(); }} />}

          <PagedSection id="exc-resolved" title={t('Resolved')} items={resolved} defaultOpen={false} showCount={false}
            empty={<p className="muted">{t('No resolved exceptions in this period.')}</p>}>
            {(shown) => <ul className="exc-list">{shown.map((e) => <ExceptionCard key={e.id} e={e} o={outletBy[e.outlet_id]} sales={salesBy[e.outlet_id] || []} onAct={act} />)}</ul>}
          </PagedSection>

          <p className="muted small rules-note">
            {t('How it works: the AI model (Chronos-2) looks at each outlet\'s sales up to the day before and predicts that day, with a usual range. A day below half of the prediction is flagged; "no sales" means the outlet sold the week before but is missing from the report. When the model can\'t be reached, the outlet\'s usual sales for that weekday are used instead. Several outlets flagged on the same day usually means one common cause (rain, a holiday, a system problem).')}
          </p>
        </>
      )}
    </div>
  );
}

function ExceptionCard({ e, o, sales, onAct }) {
  const [note, setNote] = useState('');
  const pct = e.kind === 'no_sales' ? 0 : e.pct_of_expected;
  return (
    <li className={`exc exc-${e.status}`}>
      <div className="exc-head">
        <div>
          <strong><span className="muted">{o?.code}</span> {shortName(o?.name)}</strong>
          <div className="muted small">{regionName(o?.region)} · {dayName(e.business_date)}</div>
        </div>
        <span className={`exc-badge ${pct < 30 ? 'crit' : 'warn'}`}>{e.kind === 'no_sales' ? t('No sales') : `${pct}%`}</span>
      </div>
      <div className="exc-body">
        <div>
          <strong>{t(KIND[e.kind])}</strong>
          <div className="small">
            {e.kind === 'no_sales'
              ? t('Usually about {exp} on this day.', { exp: money(e.expected) })
              : t('{net} from {bills} bills · usually about {exp}', { net: money(e.net_sales), bills: e.bills ?? '–', exp: money(e.expected) })}
            {e.usual_low != null && <span className="muted"> ({t('normal range {low}–{high}', { low: money(e.usual_low), high: money(e.usual_high) })})</span>}
          </div>
          {e.same_day > 0 && <div className="muted small">{t('{n} other outlets were also low that day — possibly a common cause.', { n: e.same_day })}</div>}
          <div className="muted small">{e.method === 'chronos2' ? t('Expected by the AI model') : t('Expected from the weekday average')} · {t(STATUS[e.status])}</div>
        </div>
        <Spark sales={sales} day={e.business_date} expected={e.expected} />
      </div>
      {e.note && <pre className="exc-note small">{e.note}</pre>}
      <div className="exc-actions">
        <input type="text" placeholder={t('Note (what happened?)')} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} />
        {e.status === 'open' && <button type="button" className="btn" onClick={() => { onAct(e, 'acknowledged', note); setNote(''); }}>{t('Looking into it')}</button>}
        {e.status !== 'resolved' && <button type="button" className="btn btn-primary" onClick={() => { onAct(e, 'resolved', note); setNote(''); }}>{t('Resolve')}</button>}
        {e.status === 'resolved' && <button type="button" className="btn" onClick={() => { onAct(e, 'open', note); setNote(''); }}>{t('Reopen')}</button>}
      </div>
    </li>
  );
}

// The outlet's last 28 days up to the flagged day; the flagged day in red, the expected level dashed
function Spark({ sales, day, expected }) {
  const pts = sales.filter((s) => s.business_date <= day).slice(-28);
  if (pts.length < 3) return null;
  const W = 180;
  const H = 48;
  const max = Math.max(...pts.map((p) => Number(p.net)), Number(expected) || 0, 1);
  const x = (i) => (i / (pts.length - 1)) * (W - 6) + 3;
  const y = (v) => H - 3 - (Number(v) / max) * (H - 6);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.net).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Sales, last 28 days')}>
      {expected > 0 && <line x1="0" x2={W} y1={y(expected)} y2={y(expected)} className="spark-exp" />}
      <path d={line} className="spark-line" />
      {last.business_date === day && <circle cx={x(pts.length - 1)} cy={y(last.net)} r="3.5" className="spark-dot" />}
    </svg>
  );
}
