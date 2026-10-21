import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesSummary, readWorkbook, ymd } from '../src/importers.js';

const rows = [
  ['Sales Summary Listing', null, null],
  [''],
  ['Printed By: someone'],
  ['Filters: ((Business Date from 1/9/2026 to 30/9/2026) or Status equal to Active)'],
  [''],
  [null, 'Business Date', 'Gross Amount Excl.', 'Discount', 'Net Sales', 'Tax', 'Charges', 'Adj. Amount', 'Tender Amount', 'Std. Cost', 'Inv. Cost', 'Item Quantity', 'Trans. Count', 'Guest Count'],
  ['Outlet: 001-US Pizza Kelana Jaya'],
  [null, new Date(Date.UTC(2026, 8, 1)), 2097.02, 434.98, 1662.04, 99.74, 17.57, 0.39, 1779.74, 0, 0, 230, 41, 0],
  [null, '2/9/2026', '2,170.58', '491.29', '1,679.29', 100.71, 13.21, 0.08, 1793.29, 0, 0, 182, 29, 0],
  [null, 'Subtotal', '63,895.59', '13,950.59', '49,945.00'],
  ['Outlet: SG03-US Pizza - West Coast Plaza'],
  [null, new Date(Date.UTC(2026, 8, 1)), 900, 100, 800, 0, 0, 0, 800, 0, 0, 50, 20, 0],
  [null, 'Grand Total', '1'],
];

test('Sales Summary: outlet blocks, Excel and text dates, numbers with commas, totals skipped', () => {
  const r = parseSalesSummary(rows);
  assert.equal(r.from, '2026-09-01');
  assert.equal(r.to, '2026-09-30');
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows[0], { name: '001-US Pizza Kelana Jaya', date: '2026-09-01', net: 1662.04, gross: 2097.02, discount: 434.98, bills: 41, guests: 0 });
  assert.equal(r.rows[1].date, '2026-09-02');
  assert.equal(r.rows[1].net, 1679.29);
  assert.equal(r.rows[2].name, 'SG03-US Pizza - West Coast Plaza');
  assert.deepEqual(r.stats, { rows: 3, outlets: 2 });
});

test('other reports are not taken for a Sales Summary', () => {
  assert.deepEqual(readWorkbook([{ sheet: 'x', data: [['Sales Details Listing'], [null, null, 'Item', 'Net Sales']] }]), { error: 'unknown' });
  assert.equal(readWorkbook([{ sheet: 'Sheet1', data: rows }]).result.rows.length, 3);
  assert.equal(ymd('30/9/2026'), '2026-09-30');
});
