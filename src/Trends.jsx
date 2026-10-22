// Outlet trends: one outlet's daily net sales, discount % and voids, each against its 28-day trailing average
// (the average of the 28 days before that day), with the days the agent flagged shaded. Three small charts on one
// time axis (never two scales on one chart); one crosshair + tooltip across all three.
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadOutlet } from './data.js';
import { t, locale } from './i18n.js';

const RANGES = [30, 90, 180];
const TRAIL = 28;
const TRAIL_MIN = 10;
const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const rm = (v) => `RM${Math.round(Number(v) || 0).toLocaleString('en-MY')}`;
const pct = (v) => `${Number(v).toFixed(1)}%`;
const shortName = (n = '') => n.replace(/^US Pizza /, '');
const dayLbl = (d, long) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString(locale(), long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

const PANELS = [
  { key: 'sales', avg: 'salesAvg', title: 'Net sales', unit: 'RM per day', color: '#2a78d6', kinds: ['sales_drop', 'no_sales'], bars: true, fmt: rm },
  { key: 'disc', avg: 'discAvg', title: 'Discounts', unit: '% of gross sales', color: '#eb6834', kinds: ['discount_spike'], bars: false, fmt: pct },
  { key: 'void', avg: 'voidAvg', title: 'Voids', unit: 'RM voided per day', color: '#1baf7a', kinds: ['void_spike'], bars: true, fmt: rm },
];

// API answer -> one row per day of the shown period, with the trailing averages
export function buildRows(d) {
  const sales = Object.fromEntries(d.sales.map((s) => [s.business_date, s]));
  const voids = Object.fromEntries(d.voids.map((v) => [v.business_date, v]));
  const covered = (day) => d.void_ranges.some(([a, b]) => a <= day && day <= b);
  const at = (day) => {
    const s = sales[day];
    if (!s || !(Number(s.net) > 0)) return null;
    const g = Number(s.gross);
    return {
      sales: Number(s.net), bills: s.bills,
      disc: g > 0 ? (100 * Number(s.discount)) / g : null,
      void: covered(day) ? Math.max(Number(voids[day]?.net) || 0, 0) : null,
      voidBills: covered(day) ? voids[day]?.bills || 0 : null,
    };
  };
  const rows = [];
  for (let day = addDays(d.to, -(d.days - 1)); day <= d.to; day = addDays(day, 1)) {
    const prior = [];
    for (let i = 1; i <= TRAIL; i += 1) { const p = at(addDays(day, -i)); if (p) prior.push(p); }
    const enough = prior.length >= TRAIL_MIN;
    const pv = prior.filter((p) => p.void != null);
    rows.push({
      d: day, ...(at(day) || { sales: null, disc: null, void: null }),
      salesAvg: enough ? mean(prior.map((p) => p.sales)) : null,
      discAvg: enough ? mean(prior.filter((p) => p.disc != null).map((p) => p.disc)) : null,
      voidAvg: pv.length >= TRAIL_MIN ? mean(pv.map((p) => p.void)) : null,
    });
  }
  // the report's last day is often still in progress or not uploaded yet: drop empty days at the end
  while (rows.length && rows[rows.length - 1].sales == null) rows.pop();
  return rows;
}

export default function Trends({ outlets, outletId, onPick }) {
  const [range, setRange] = useState(90);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!outletId) return;
    let live = true;
    setLoading(true);
    setError('');
    loadOutlet(outletId, range)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [outletId, range]);

  const rows = useMemo(() => (data && data.outlet.outlet_id === outletId ? buildRows(data) : []), [data, outletId]);
  const flags = data?.exceptions || [];
  const sorted = useMemo(() => [...outlets].sort((a, b) => String(a.code).localeCompare(String(b.code))), [outlets]);

  return (
    <section className="card trends" id="trends">
      <div className="card-head trends-head">
        <h2>{t('Outlet trends')}</h2>
        <div className="trends-controls">
          <select value={outletId || ''} onChange={(e) => onPick(e.target.value)} aria-label={t('Outlet')}>
            {!outletId && <option value="">{t('Choose outlet…')}</option>}
            {sorted.map((o) => <option key={o.outlet_id} value={o.outlet_id}>{o.code} {shortName(o.name)}</option>)}
          </select>
          <div className="seg" role="group" aria-label={t('Period')}>
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{t('{n} days', { n: r })}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted small">{t("Each day against the outlet's 28-day trailing average (the average of the 28 days before it). Days the agent flagged are shaded red. Hover or tap a chart to see that day across all three.")}</p>
      {!outletId ? <p className="muted">{t('Choose an outlet to see its trends.')}</p>
        : error ? <div className="error">{t("Couldn't load: {error}", { error })}</div>
        : !rows.length ? <p className="muted">{loading ? t('Loading…') : t('No sales uploaded for this outlet yet.')}</p>
        : <TrendCharts rows={rows} flags={flags} loading={loading} />}
    </section>
  );
}

function TrendCharts({ rows, flags, loading }) {
  const box = useRef(null);
  const [W, setW] = useState(800);
  const [hover, setHover] = useState(null); // row index
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 600;
  const H = narrow ? 140 : 160;
  const m = { l: narrow ? 50 : 62, r: 8, t: 8, b: 22 };
  const n = rows.length;
  const bw = (W - m.l - m.r) / n;
  const X = (i) => m.l + (i + 0.5) * bw;
  const flagged = (day, kinds) => flags.find((f) => f.business_date === day && kinds.includes(f.kind));
  const ticks = rows.map((r, i) => [r, i]).filter(([r]) => (n <= 45 ? r.d.endsWith('-01') || r.d.endsWith('-08') || r.d.endsWith('-15') || r.d.endsWith('-22') : r.d.endsWith('-01') || (!narrow && r.d.endsWith('-15'))));

  // last 7 days vs the 28 before them
  const tiles = PANELS.map((p) => {
    const last = rows.slice(-7).map((r) => r[p.key]).filter((v) => v != null);
    const before = rows.slice(-35, -7).map((r) => r[p.key]).filter((v) => v != null);
    const a = mean(last);
    const b = mean(before);
    const isPct = p.key === 'disc';
    const diff = a == null || b == null ? null : isPct ? a - b : b ? (100 * (a - b)) / b : null;
    return { p, a, b, diff, isPct };
  });

  const move = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((x - m.l) / bw))));
  };
  const row = hover == null ? null : rows[hover];
  const rowFlags = row ? flags.filter((f) => f.business_date === row.d) : [];

  return (
    <div className={`trend-body ${loading ? 'is-loading' : ''}`}>
      <div className="trend-tiles">
        {tiles.map(({ p, a, b, diff, isPct }) => (
          <div key={p.key} className="trend-tile">
            <div className="small"><span className="sw" style={{ background: p.color }} /> {t(p.title)} · {t('last 7 days')}</div>
            <div className="trend-val">{a == null ? '–' : p.fmt(a)} <span className="small muted">{isPct ? t('average') : t('a day')}</span></div>
            {diff != null && (
              <div className="small muted">
                {diff >= 0 ? '▲' : '▼'} {isPct ? t('{n} pts', { n: Math.abs(diff).toFixed(1) }) : `${Math.abs(Math.round(diff))}%`} {t('vs the 28 days before ({v})', { v: p.fmt(b) })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="trend-legend small muted">
        <span><svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" className="trend-avg" /></svg> {t('28-day trailing average')}</span>
        <span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" className="trend-flagband" style={{ stroke: 'var(--st-crit)' }} /></svg> {t('Flagged by the agent')}</span>
      </div>
      <div className="trend-charts" ref={box} onMouseLeave={() => setHover(null)}>
        {PANELS.map((p) => {
          const vals = rows.flatMap((r) => [r[p.key], r[p.avg]]).filter((v) => v != null);
          const top = (vals.length ? Math.max(...vals) : 1) * 1.08 || 1;
          const e10 = 10 ** Math.floor(Math.log10(top));
          const step = [1, 2, 2.5, 5, 10].map((k) => k * e10).find((s) => top / s <= 4);
          const y1 = Math.ceil(top / step) * step;
          const Y = (v) => m.t + (1 - v / y1) * (H - m.t - m.b);
          const grid = [];
          for (let v = 0; v <= y1 + 1e-9; v += step) grid.push(v);
          const w = Math.max(bw - 2, 1);
          let line = '';
          let pen = false;
          rows.forEach((r, i) => {
            if (r[p.key] == null) { pen = false; return; }
            line += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[p.key]).toFixed(1)}`;
            pen = true;
          });
          let avg = '';
          pen = false;
          rows.forEach((r, i) => {
            if (r[p.avg] == null) { pen = false; return; }
            avg += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[p.avg]).toFixed(1)}`;
            pen = true;
          });
          const noVoidData = p.key === 'void' && !rows.some((r) => r.void != null);
          return (
            <div key={p.key} className="trend-panel">
              <div className="trend-title"><strong>{t(p.title)}</strong> <span className="muted small">· {t(p.unit)}</span></div>
              {noVoidData ? <p className="muted small">{t('No Voids export uploaded for this period yet.')}</p> : (
                <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={t('{what} per day with 28-day trailing average', { what: t(p.title) })} onMouseMove={move} onClick={move}>
                  {rows.map((r, i) => (flagged(r.d, p.kinds) ? <rect key={`f${i}`} className="trend-flagband" x={X(i) - bw / 2} y={m.t} width={bw} height={H - m.t - m.b} /> : null))}
                  <g className="trend-grid">
                    {grid.map((v) => (
                      <g key={v}>
                        <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />
                        <text x={m.l - 6} y={Y(v) + 4} textAnchor="end">{p.fmt(v).replace('.0%', '%')}</text>
                      </g>
                    ))}
                    {ticks.map(([r, i]) => <text key={r.d} x={X(i)} y={H - 6} textAnchor="middle">{dayLbl(r.d)}</text>)}
                  </g>
                  {p.bars
                    ? rows.map((r, i) => {
                      if (!(r[p.key] > 0)) return null;
                      const y = Y(r[p.key]);
                      const h = Y(0) - y;
                      const rad = Math.min(w / 2, 2, h);
                      const x0 = X(i) - w / 2;
                      return <path key={i} d={`M${x0},${Y(0)}V${y + rad}Q${x0},${y} ${x0 + rad},${y}H${x0 + w - rad}Q${x0 + w},${y} ${x0 + w},${y + rad}V${Y(0)}Z`} style={{ fill: p.color }} />;
                    })
                    : <path d={line} style={{ fill: 'none', stroke: p.color, strokeWidth: 2, strokeLinejoin: 'round' }} />}
                  <path d={avg} className="trend-avg" />
                  {rows.map((r, i) => (flagged(r.d, p.kinds) && r[p.key] != null ? <circle key={`d${i}`} className="trend-flagdot" cx={X(i)} cy={Y(r[p.key])} r="4" /> : null))}
                  {hover != null && <line className="trend-cross" x1={X(hover)} x2={X(hover)} y1={m.t} y2={H - m.b} />}
                </svg>
              )}
            </div>
          );
        })}
        {row && (
          <div className="trend-tip" style={{ left: X(hover) > W - 250 ? Math.max(0, X(hover) - 240) : X(hover) + 12 }}>
            <strong>{dayLbl(row.d, true)}</strong>
            {row.sales == null ? <div>{t('No sales in the report')}</div> : (
              <>
                {PANELS.map((p) => (
                  <div key={p.key} className="trend-tip-row">
                    <span>{t(p.title)}</span>
                    <span>{row[p.key] == null ? '–' : p.fmt(row[p.key])} <em>{t('avg {v}', { v: row[p.avg] == null ? '–' : p.fmt(row[p.avg]) })}</em></span>
                  </div>
                ))}
                <div className="trend-tip-row"><span>{t('Bills')}</span><span>{row.bills ?? '–'}{row.voidBills ? <em> {t('{n} voided', { n: row.voidBills })}</em> : null}</span></div>
              </>
            )}
            {rowFlags.map((f) => (
              <div key={f.id} className="trend-tip-flag">⚠ {f.kind === 'discount_spike' ? t('Flagged: discounts {v}% (usual {u}%)', { v: f.value, u: f.usual })
                : f.kind === 'void_spike' ? t('Flagged: voids {v} (usual {u})', { v: rm(f.value), u: rm(f.usual) })
                : f.kind === 'no_sales' ? t('Flagged: no sales in the report')
                : t('Flagged: sales {p}% of expected', { p: f.pct_of_expected })}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
