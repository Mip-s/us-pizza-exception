import { useState } from 'react';
import readXlsxFile from 'read-excel-file/browser';
import { readWorkbook } from './importers.js';
import { importSales, detectAll, notify, linkName } from './data.js';
import { t } from './i18n.js';

// Operations: drop the Sales Summary Listing export(s) here. Read in the browser (src/importers.js); the rows go to the
// Worker, then the uploaded days are checked (Chronos-2) and the new exceptions are pushed.
export default function Upload({ outlets, onImported }) {
  const [files, setFiles] = useState([]); // { name, result, error, done }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [dragging, setDragging] = useState(false);

  const add = async (list) => {
    list = list.filter((f) => /\.xlsx$/i.test(f.name));
    if (!list.length) return;
    const read = await Promise.all(
      list.map(async (file) => {
        try {
          const w = readWorkbook(await readXlsxFile(file));
          return w.error ? { name: file.name, error: t('Not a Sales Summary Listing — skipped.') } : { name: file.name, result: w.result };
        } catch (err) {
          return { name: file.name, error: t("Couldn't read this file: {error}", { error: err.message }) };
        }
      })
    );
    setFiles((prev) => [...prev.filter((f) => !f.done), ...read]);
  };

  const upload = async () => {
    setBusy(true);
    const out = [];
    const days = new Set();
    for (const f of files) {
      if (f.error || f.done) {
        out.push(f);
        continue;
      }
      try {
        setProgress(t('Uploading {name}…', { name: f.name }));
        const r = await importSales({ file_name: f.name, date_from: f.result.from, date_to: f.result.to, rows: f.result.rows });
        r.detect_days.forEach((d) => days.add(d));
        out.push({ ...f, done: r });
      } catch (err) {
        out.push({ ...f, error: t('Upload failed: {error}', { error: err.message }) });
      }
      setFiles([...out, ...files.slice(out.length)]);
    }
    let msg = t('Upload finished.');
    if (days.size) {
      try {
        const list = [...days].sort().reverse();
        const r = await detectAll(list, (done, total) => setProgress(t('Checking sales… {done}/{total} days (the first check can take a minute)', { done, total })));
        msg = `${msg} ${t('{days} days checked: {n} exceptions.', { days: list.length, n: r.flagged })}`;
        if (r.method === 'baseline') msg = `${msg} ${t('The AI model could not be reached, so the weekday average was used ({error}).', { error: r.model_error || '' })}`;
        setProgress(t('Sending alerts…'));
        const n = await notify();
        if (n.people) msg = `${msg} ${t('Alerts sent to {n} people.', { n: n.people })}`;
      } catch (err) {
        msg = `${msg} ${t("Checking didn't finish: {error}", { error: err.message })}`;
      }
    }
    setProgress('');
    setFiles(out);
    setBusy(false);
    await onImported(msg);
  };

  const ready = files.some((f) => !f.error && !f.done);

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('Upload Sales Summary')}</h2>
        <span className="muted small">{t('Operations only · re-uploading the same days is safe')}</span>
      </div>
      <p className="muted small">{t('Every morning, export the Sales Summary Listing for yesterday (or the last few days) and drop it below. Business Date, all outlets.')}</p>

      <label
        className={`dropzone ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) add([...e.dataTransfer.files]); }}
      >
        <input type="file" accept=".xlsx" multiple hidden disabled={busy} onChange={(e) => { const l = [...e.target.files]; e.target.value = ''; add(l); }} />
        <strong>{t('Drop the .xlsx files here')}</strong>
        <span className="muted small">{t('or click to choose')}</span>
      </label>

      {files.length > 0 && (
        <ul className="upload-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className={f.error ? 'is-error' : f.done ? 'is-done' : ''}>
              <div className="upload-head">
                <strong>{f.name}</strong>
                {f.result?.from && <span className="muted small"> · {f.result.from === f.result.to ? f.result.from : `${f.result.from} – ${f.result.to}`}</span>}
                {!f.done && !busy && <button type="button" className="link-btn small" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label={t('Remove')}>✕</button>}
              </div>
              {f.error && <div className="error small">{f.error}</div>}
              {!f.error && f.result && !f.done && <div className="small">{t('{rows} outlet-days · {outlets} outlets', f.result.stats)}</div>}
              {f.done && (
                <div className="small ok-text">
                  {t('Uploaded: {rows} outlet-days for {outlets} outlets.', { rows: f.done.rows, outlets: f.done.outlets })}
                  {f.done.skipped?.length > 0 && <span className="muted"> {t('Not checked (MFM / franchise): {n}.', { n: f.done.skipped.length })}</span>}
                </div>
              )}
              {f.done?.unmatched?.length > 0 && <Unmatched names={f.done.unmatched} outlets={outlets} />}
            </li>
          ))}
        </ul>
      )}

      {progress && <p className="muted small" role="status">{progress}</p>}
      {ready && (
        <button type="button" className="btn btn-primary" onClick={upload} disabled={busy}>
          {busy ? t('Working…') : t('Upload and check')}
        </button>
      )}
    </section>
  );
}

// Outlet names in the report that match no hub outlet: link each once (or ignore it for good), then upload again
const IGNORE = '__ignore';
function Unmatched({ names, outlets }) {
  const [picked, setPicked] = useState({});
  const [saved, setSaved] = useState({});
  const [err, setErr] = useState('');
  const save = async (name) => {
    try {
      const ignore = picked[name] === IGNORE;
      await linkName(name, ignore ? null : picked[name]);
      setSaved((s) => ({ ...s, [name]: ignore ? 'ignored' : 'linked' }));
      setErr('');
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="unmatched small">
      <div className="late-text">{t('These names in the report match no outlet. Link or ignore them, then upload the file again:')}</div>
      {names.map((n) => (
        <div key={n} className="unmatched-row">
          <span>{n}</span>
          {saved[n] ? (
            <span className={saved[n] === 'ignored' ? 'muted' : 'ok-text'}>{saved[n] === 'ignored' ? t('Ignored ✓') : t('Linked ✓')}</span>
          ) : (
            <>
              <select value={picked[n] || ''} onChange={(e) => setPicked((p) => ({ ...p, [n]: e.target.value }))}>
                <option value="">{t('Choose outlet…')}</option>
                <option value={IGNORE}>{t("Ignore — don't check this name")}</option>
                {outlets.map((o) => <option key={o.outlet_id} value={o.outlet_id}>{o.code} {o.name}</option>)}
              </select>
              <button type="button" className="link-btn" disabled={!picked[n]} onClick={() => save(n)}>{t('Link')}</button>
            </>
          )}
        </div>
      ))}
      {err && <div className="error small">{err}</div>}
    </div>
  );
}
