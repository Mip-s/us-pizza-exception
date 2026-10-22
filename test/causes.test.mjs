import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarFacts, holidaysOn } from '../worker/calendar.js';
import { parseCauses, ruleCauses, buildMessages } from '../worker/causes.js';

test('calendar: state holidays, eves, school holidays, payday', () => {
  assert.deepEqual(holidaysOn('2026-12-11', { country: 'MY', state: 'Selangor' }), ["Sultan of Selangor's Birthday"]);
  assert.deepEqual(holidaysOn('2026-12-11', { country: 'MY', state: 'Johor' }), []);
  assert.deepEqual(holidaysOn('2026-11-08', { country: 'MY', state: 'Sarawak' }), []); // no Deepavali in Sarawak
  assert.deepEqual(holidaysOn('2026-08-10', { country: 'SG' }), ['National Day (in lieu)']);
  const f = calendarFacts('2026-11-07', { country: 'MY', state: 'Selangor' });
  assert.equal(f.weekday, 'Saturday');
  assert.equal(f.eve_of_holiday, 'Deepavali');
  assert.equal(calendarFacts('2026-05-25', { country: 'MY', state: 'Kedah' }).school_holidays, '2026-05-22 to 2026-06-06');
  assert.ok(calendarFacts('2026-10-28', { country: 'MY', state: 'Selangor' }).payday_window);
  assert.ok(calendarFacts('2026-03-01', { country: 'MY', state: 'Selangor' }).ramadan);
});

test('AI answer: JSON pulled out of the text, cleaned, capped at 3', () => {
  const r = parseCauses('<think>x</think>Sure! {"tag":"Heavy rain","causes":[{"cause":"Heavy rain at lunch","likelihood":"HIGH","evidence":"32 mm","check":"delivery share"},{"cause":"b","likelihood":"maybe"},{"cause":"c"},{"cause":"d"}]}');
  assert.equal(r.tag, 'Heavy rain');
  assert.equal(r.causes.length, 3);
  assert.equal(r.causes[0].likelihood, 'high');
  assert.equal(r.causes[1].likelihood, 'low');
  assert.equal(parseCauses('no json here'), null);
  assert.equal(parseCauses('{"causes":[]}'), null);
});

test('rules when the AI is down: weather, promotions, voids', () => {
  const rain = ruleCauses({ kind: 'sales_drop' }, { weather: { summary: 'heavy rain while open', rain_mm_while_open: 30, hours_with_rain_while_open: 5 }, calendar: {}, others: {}, ops: {} });
  assert.equal(rain.causes[0].cause, 'Heavy rain');
  const promo = ruleCauses({ kind: 'discount_spike' }, { promotions: [{ name: 'Buy 1 Free 1' }], others: {}, ops: {} });
  assert.match(promo.tag, /Buy 1 Free 1/);
  const v = ruleCauses({ kind: 'void_spike' }, { outlet: { voided_bills: 1, voided_rm: 400 }, others: {}, ops: {} });
  assert.equal(v.causes[0].cause, 'Large order voided');
  assert.equal(ruleCauses({ kind: 'sales_drop' }, { calendar: {}, others: {}, ops: {} }).causes[0].cause, 'No clear cause in the data');
});

test('prompt carries the facts and asks for JSON only', () => {
  const m = buildMessages({ kind: 'sales_drop', business_date: '2026-10-16' }, { code: '026', name: 'US Pizza ST Rosyam Mall Klang', region: 'Klang Valley', state: 'Selangor', country: 'MY' }, { weather: { rain_mm_while_open: 30 } });
  assert.match(m[0].content, /ONLY the facts/);
  assert.match(m[1].content, /026 ST Rosyam Mall Klang/);
  assert.match(m[1].content, /"rain_mm_while_open":30/);
});
