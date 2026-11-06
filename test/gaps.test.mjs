import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingRanges, totalMissing, formatRanges, coverage } from '../src/gaps.js';

const file = (from, to) => ({ period_from: from, period_to: to });

test('a week missed and a file with only today: every day in between is missing', () => {
  const r = missingRanges([file('2026-11-02', '2026-11-02')], '2026-10-21', '2026-11-02');
  assert.deepEqual(r, [{ from: '2026-10-22', to: '2026-11-01', days: 11 }]);
  assert.equal(totalMissing(r), 11);
  assert.equal(formatRanges(r), '22/10 – 01/11');
});

test('a 30-day file reaching back past the last upload is fine', () => {
  assert.deepEqual(missingRanges([file('2026-10-03', '2026-11-02')], '2026-10-21', '2026-11-02'), []);
});

test('daily upload (last upload yesterday) is fine, even with a single-day file', () => {
  assert.deepEqual(missingRanges([file('2026-11-02', '2026-11-02')], '2026-11-01', '2026-11-02'), []);
});

test('two files together can cover the gap; a hole between them is reported', () => {
  assert.deepEqual(missingRanges([file('2026-10-22', '2026-10-25'), file('2026-10-26', '2026-11-02')], '2026-10-21', '2026-11-02'), []);
  const r = missingRanges([file('2026-10-22', '2026-10-24'), file('2026-10-27', '2026-11-02')], '2026-10-21', '2026-11-02');
  assert.deepEqual(r, [{ from: '2026-10-25', to: '2026-10-26', days: 2 }]);
});

test('first ever upload, or no readable dates: no warning', () => {
  assert.deepEqual(missingRanges([file('2026-11-02', '2026-11-02')], null, '2026-11-02'), []);
  assert.deepEqual(missingRanges([{}], '2026-10-21', '2026-11-02'), []);
});

test('falls back to the first/last PO date when the title has no period', () => {
  assert.deepEqual(coverage({ from: '2026-10-01', to: '2026-10-05' }), { from: '2026-10-01', to: '2026-10-05' });
});
