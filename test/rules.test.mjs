import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, isMfm, resolver, weekdayBaseline, judge, detectDays, addDays, judgeDiscount, judgeVoids } from '../worker/rules.js';
import { summary } from '../worker/messages.js';

const outlets = [
  { outlet_id: 'kj', name: 'US Pizza Kelana Jaya' },
  { outlet_id: 'amp', name: 'US Pizza Ampang' },
  { outlet_id: 'kw', name: 'US Pizza Kota Warisan' },
  { outlet_id: 'wcp', name: 'US Pizza West Coast Plaza' },
  { outlet_id: 'ma', name: 'US Pizza Mount Austin' },
  { outlet_id: 'bp', name: 'US Pizza Batu Pahat' },
  { outlet_id: 'bpm', name: 'US Pizza Batu Pahat Mall' },
  { outlet_id: 'icity', name: 'US Pizza I-City' },
];

test('report names: the code in front is ignored, "US Pizza" and punctuation too', () => {
  assert.equal(nameKey('001-US Pizza Kelana Jaya'), 'kelanajaya');
  assert.equal(nameKey('SG03-US Pizza - West Coast Plaza'), 'westcoastplaza');
  assert.equal(nameKey('055-US Pizza Lucernce Square, Penang'), 'lucerncesquarepenang');
  assert.equal(nameKey('US Pizza I-City'), 'icity');
  assert.ok(isMfm('026M-The Manhattan Fish Market (Landmark)'));
  assert.ok(!isMfm('001-US Pizza Kelana Jaya'));
});

test('matching by name, not by the report code (report 002 = Kota Warisan, hub 002 = Ampang)', () => {
  const r = resolver(outlets, { austin: 'ma' });
  assert.deepEqual(r('002-US Pizza Kota Warisan'), { outlet_id: 'kw', learnt: true });
  assert.deepEqual(r('009-US Pizza Ampang'), { outlet_id: 'amp', learnt: true });
  assert.deepEqual(r('016-US Pizza Austin'), { outlet_id: 'ma', learnt: false }); // saved alias
  assert.deepEqual(r('015-US Pizza Batu Pahat'), { outlet_id: 'bp', learnt: true }); // exact beats "contains"
  assert.deepEqual(r('051-US Pizza  Central I-City'), { outlet_id: 'icity', learnt: true }); // unique "contains"
  assert.equal(r('052-US Pizza Rawang'), null);
  const ig = resolver(outlets, { hqkiosk: null });
  assert.deepEqual(ig('HQA-US Pizza HQ Kiosk'), { ignored: true }); // ignored on the board
});

test('weekday baseline: outlet level x weekday pattern', () => {
  const hist = [];
  for (let i = 0; i < 28; i++) {
    const d = addDays('2026-09-01', i);
    const sat = new Date(`${d}T00:00:00Z`).getUTCDay() === 6;
    hist.push({ outlet_id: 'a', business_date: d, net: sat ? 2000 : 1000 }, { outlet_id: 'b', business_date: d, net: sat ? 4000 : 2000 });
  }
  const base = weekdayBaseline(hist);
  assert.equal(Math.round(base('a', '2026-10-03')), 2000); // a Saturday
  assert.equal(Math.round(base('b', '2026-10-05')), 2000); // a Monday
  assert.equal(base('zz', '2026-10-05'), null);
});

test('judge: below half = sales drop, no row = no sales, tiny expectations ignored', () => {
  const exp = { expected: 2000 };
  assert.equal(judge({ net: 1200 }, exp), null);
  assert.deepEqual(judge({ net: 400 }, exp), { kind: 'sales_drop', net_sales: 400, pct_of_expected: 20 });
  assert.deepEqual(judge(null, exp), { kind: 'no_sales', net_sales: 0, pct_of_expected: 0 });
  assert.equal(judge({ net: 10 }, { expected: 100 }), null);
  assert.equal(judge({ net: 10 }, null), null);
});

test('days to check: newest first, not today, not older than 35 days', () => {
  assert.deepEqual(detectDays(['2026-10-20', '2026-10-19', '2026-10-20', '2026-10-21', '2026-08-01'], '2026-10-21'), ['2026-10-20', '2026-10-19']);
});

test('push summary in the user\'s language, ranked by RM at stake across kinds, capped', () => {
  const list = [
    { code: '075', name: 'US Pizza Hextar World Empire City Mall', business_date: '2026-09-27', kind: 'sales_drop', net_sales: 113.79, expected: 1141.33, pct_of_expected: 10, impact: 1028 },
    { code: '014', name: 'US Pizza Batu Pahat', business_date: '2026-09-27', kind: 'no_sales', net_sales: 0, expected: 1500, pct_of_expected: 0, impact: 1500 },
    { code: '005', name: 'US Pizza SS2', business_date: '2026-09-27', kind: 'void_spike', value: 391, usual: 0, impact: 391, bills: 1 },
    { code: '033', name: 'US Pizza Dpulze', business_date: '2026-09-27', kind: 'discount_spike', value: 33, usual: 22, impact: 553 },
    { code: '001', name: 'US Pizza Kelana Jaya', business_date: '2026-09-27', kind: 'sales_drop', net_sales: 500, expected: 1700, pct_of_expected: 29, impact: 1200 },
  ];
  const en = summary(list, 'en');
  assert.equal(en.title, '🚨 Exceptions · 5 outlets');
  const lines = en.body.split('\n');
  assert.match(lines[0], /^014 Batu Pahat 27\/9: no sales in the report \(usual RM1,500\)/);
  assert.match(lines[1], /^001 Kelana Jaya 27\/9: sales RM500 \(29% of usual RM1,700\)/);
  assert.match(lines[3], /^033 Dpulze 27\/9: discounts 33% of sales \(usual 22%, \+RM553\)/);
  assert.equal(lines[4], '+1 more');
  assert.match(summary(list.slice(2, 3), 'en').body, /005 SS2 27\/9: RM391 voided in 1 bills \(usual RM0\)/);
  assert.match(summary(list.slice(0, 1), 'ms').title, /Pengecualian · 1 outlet/);
  assert.match(summary(list, 'xx').title, /Exceptions/);
});

test('discount spike: far above the outlet\'s own usual share, and enough RM', () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ gross: 3000, discount: 700 + (i % 5) * 20 })); // ~24-26%
  assert.equal(judgeDiscount({ gross: 3000, discount: 800 }, hist), null); // 27%: normal
  const r = judgeDiscount({ gross: 3000, discount: 1300 }, hist); // 43%
  assert.equal(r.kind, 'discount_spike');
  assert.equal(r.value, 43);
  assert.ok(r.impact >= 150);
  assert.equal(judgeDiscount({ gross: 500, discount: 250 }, hist), null); // 50%, but only ~RM125 extra on a small day: below RM150
  assert.equal(judgeDiscount({ gross: 3000, discount: 1300 }, hist.slice(0, 5)), null); // too little history
});

test('void spike: well above the outlet\'s usual voids, at least RM200 and 10% of sales', () => {
  const hist = [0, 0, 40, 0, 60, 0, 0, 25, 0, 0, 50, 0, 0, 0];
  assert.equal(judgeVoids(150, hist, 2500), null); // below RM200
  assert.equal(judgeVoids(220, hist, 4000), null); // under 10% of sales
  const r = judgeVoids(400, hist, 2500);
  assert.equal(r.kind, 'void_spike');
  assert.equal(r.value, 400);
  assert.equal(r.usual, 0);
  assert.equal(judgeVoids(400, Array(14).fill(150), 2500), null); // this outlet usually voids ~RM150: 400 is < 3x
});
