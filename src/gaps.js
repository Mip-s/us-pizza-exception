// Upload gap check (6/11, copy of the GRN Chaser's gaps.js): the daily Sales Summary should cover every business day since the last day already uploaded.
// If operations missed some days and the new file(s) only reach back a day or two, the days in between would never
// reach the board — the page warns first. For sales, lastUploadDate = the last business day already in the database. Pure functions (tests: test/gaps.test.mjs); dates are 'YYYY-MM-DD'.
const DAY = 24 * 60 * 60 * 1000;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const iso = (n) => new Date(n).toISOString().slice(0, 10);

// The period a file covers: the export period in its title when there is one, else its first/last PO date.
export const coverage = (result) => {
  const from = result?.period_from || result?.from;
  const to = result?.period_to || result?.to;
  return from && to ? { from, to } : null;
};

/**
 * Days after the last upload (up to yesterday — today is still being keyed in) that none of the files cover.
 * lastUploadDate = local date of the last successful upload (null = first ever upload: nothing to compare).
 * Returns consecutive missing runs [{ from, to, days }], oldest first; [] when nothing is missing.
 */
export function missingRanges(results, lastUploadDate, today) {
  if (!lastUploadDate || !today) return [];
  const spans = results.map(coverage).filter(Boolean).map((c) => [ms(c.from), ms(c.to)]);
  if (!spans.length) return [];
  const out = [];
  for (let d = ms(lastUploadDate) + DAY; d < ms(today); d += DAY) {
    if (spans.some(([a, b]) => d >= a && d <= b)) continue;
    const last = out[out.length - 1];
    if (last && ms(last.to) + DAY === d) {
      last.to = iso(d);
      last.days += 1;
    } else out.push({ from: iso(d), to: iso(d), days: 1 });
  }
  return out;
}

export const totalMissing = (ranges) => ranges.reduce((n, r) => n + r.days, 0);
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const formatRanges = (ranges) => ranges.map((r) => (r.from === r.to ? dm(r.from) : `${dm(r.from)} – ${dm(r.to)}`)).join(', ');
