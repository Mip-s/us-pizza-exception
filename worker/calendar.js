// Calendar facts for "possible causes": public holidays (Malaysia by state, Singapore), school holidays, Ramadan,
// payday. 2026 dates from the published gazette lists (ajobthing.com / MOE via says.com / MOM via info-tech.com.sg,
// checked 22/10/2026). Add next year's lines before January.

// states as public.outlets.state spells them
const ALL = '*';
const MY_HOLIDAYS = [
  ['2026-01-01', "New Year's Day", { except: ['Johor', 'Kedah', 'Kelantan', 'Perlis', 'Terengganu'] }],
  ['2026-01-14', "Negeri Sembilan Ruler's Birthday", ['Negeri Sembilan']],
  ['2026-01-17', 'Israk & Mikraj', ['Kedah', 'Negeri Sembilan', 'Perlis', 'Terengganu']],
  ['2026-02-01', 'Thaipusam', ['Johor', 'Kuala Lumpur', 'Negeri Sembilan', 'Pulau Pinang', 'Perak', 'Putrajaya', 'Selangor']],
  ['2026-02-01', 'Federal Territory Day', ['Kuala Lumpur', 'Labuan', 'Putrajaya']],
  ['2026-02-02', 'Thaipusam / Federal Territory Day (replacement)', ['Johor', 'Kuala Lumpur', 'Negeri Sembilan', 'Pulau Pinang', 'Perak', 'Putrajaya', 'Selangor', 'Labuan']],
  ['2026-02-17', 'Chinese New Year', ALL],
  ['2026-02-18', 'Chinese New Year (2nd day)', ALL],
  ['2026-02-19', 'Awal Ramadan', ['Johor', 'Kedah']],
  ['2026-02-20', 'Independence Declaration Day', ['Melaka']],
  ['2026-03-07', 'Nuzul Al-Quran', { except: ['Johor', 'Kedah', 'Melaka', 'Negeri Sembilan', 'Sabah', 'Sarawak'] }],
  ['2026-03-21', 'Hari Raya Aidilfitri', ALL],
  ['2026-03-22', 'Hari Raya Aidilfitri (2nd day)', ALL],
  ['2026-03-23', 'Hari Raya Aidilfitri (replacement)', { except: ['Kedah'] }],
  ['2026-03-23', "Sultan of Johor's Birthday", ['Johor']],
  ['2026-03-24', 'Hari Raya Aidilfitri (extra)', ['Melaka']],
  ['2026-03-30', "Sabah Governor's Birthday", ['Sabah']],
  ['2026-04-03', 'Good Friday', ['Sabah', 'Sarawak']],
  ['2026-05-01', 'Labour Day', ALL],
  ['2026-05-27', 'Hari Raya Haji', ALL],
  ['2026-05-28', 'Hari Raya Haji (2nd day)', ['Kedah', 'Kelantan', 'Perlis', 'Terengganu']],
  ['2026-05-30', 'Harvest Festival', ['Sabah', 'Labuan']],
  ['2026-05-31', 'Wesak Day', ALL],
  ['2026-05-31', 'Harvest Festival (2nd day)', ['Sabah', 'Labuan']],
  ['2026-06-01', "Agong's Birthday / Wesak (replacement)", ALL],
  ['2026-06-01', 'Hari Gawai', ['Sarawak']],
  ['2026-06-02', 'Hari Gawai (2nd day)', ['Sarawak']],
  ['2026-06-17', 'Awal Muharram', ALL],
  ['2026-06-21', "Sultan of Kedah's Birthday", ['Kedah']],
  ['2026-07-07', 'George Town World Heritage City Day', ['Pulau Pinang']],
  ['2026-07-11', "Penang Governor's Birthday", ['Pulau Pinang']],
  ['2026-07-21', 'Hari Hol Almarhum Sultan Iskandar', ['Johor']],
  ['2026-07-22', 'Sarawak Day', ['Sarawak']],
  ['2026-08-24', "Melaka Governor's Birthday", ['Melaka']],
  ['2026-08-25', "Prophet Muhammad's Birthday", ALL],
  ['2026-08-31', 'Merdeka Day', ALL],
  ['2026-09-16', 'Malaysia Day', ALL],
  ['2026-10-10', "Sarawak Governor's Birthday", ['Sarawak']],
  ['2026-11-06', "Sultan of Perak's Birthday", ['Perak']],
  ['2026-11-08', 'Deepavali', { except: ['Sarawak'] }],
  ['2026-11-09', 'Deepavali (replacement)', { except: ['Kedah', 'Kelantan', 'Sarawak', 'Terengganu'] }],
  ['2026-12-11', "Sultan of Selangor's Birthday", ['Selangor']],
  ['2026-12-24', 'Christmas Eve', ['Sabah']],
  ['2026-12-25', 'Christmas Day', ALL],
];
const SG_HOLIDAYS = [
  ['2026-01-01', "New Year's Day"], ['2026-02-17', 'Chinese New Year'], ['2026-02-18', 'Chinese New Year (2nd day)'],
  ['2026-03-21', 'Hari Raya Puasa'], ['2026-04-03', 'Good Friday'], ['2026-05-01', 'Labour Day'], ['2026-05-27', 'Hari Raya Haji'],
  ['2026-05-31', 'Vesak Day'], ['2026-06-01', 'Vesak Day (in lieu)'], ['2026-08-09', 'National Day'], ['2026-08-10', 'National Day (in lieu)'],
  ['2026-11-08', 'Deepavali'], ['2026-11-09', 'Deepavali (in lieu)'], ['2026-12-25', 'Christmas Day'],
];
// MOE 2026: Group A = Kedah, Kelantan, Terengganu; Group B = everyone else
const SCHOOL_A = [['2026-02-15', '2026-02-19'], ['2026-03-19', '2026-03-28'], ['2026-05-22', '2026-06-06'], ['2026-08-28', '2026-09-05'], ['2026-12-04', '2026-12-31']];
const SCHOOL_B = [['2026-02-16', '2026-02-20'], ['2026-03-19', '2026-03-29'], ['2026-05-23', '2026-06-07'], ['2026-08-29', '2026-09-06'], ['2026-12-05', '2026-12-31']];
const GROUP_A = ['Kedah', 'Kelantan', 'Terengganu'];
const RAMADAN = [['2026-02-19', '2026-03-20']];

const DAY = 864e5;
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const applies = (scope, state) => scope === ALL || (Array.isArray(scope) ? scope.includes(state) : !scope.except.includes(state));

// public holiday names on `day` for an outlet (country 'MY' + state, or 'SG')
export function holidaysOn(day, { country, state }) {
  if (country === 'SG') return SG_HOLIDAYS.filter(([d]) => d === day).map(([, n]) => n);
  return MY_HOLIDAYS.filter(([d, , scope]) => d === day && applies(scope, state)).map(([, n]) => n);
}

// Everything about the date itself, as short facts
export function calendarFacts(day, outlet) {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  const dom = Number(day.slice(8, 10));
  const facts = { weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd], weekend: wd === 0 || wd === 6 };
  const today = holidaysOn(day, outlet);
  if (today.length) facts.public_holiday = today.join(', ');
  const eve = holidaysOn(add(day, 1), outlet);
  if (eve.length) facts.eve_of_holiday = eve.join(', ');
  const after = holidaysOn(add(day, -1), outlet);
  if (after.length) facts.day_after_holiday = after.join(', ');
  if (outlet.country !== 'SG') {
    const school = (GROUP_A.includes(outlet.state) ? SCHOOL_A : SCHOOL_B).find(([a, b]) => a <= day && day <= b);
    if (school) facts.school_holidays = `${school[0]} to ${school[1]}`;
    if (RAMADAN.some(([a, b]) => a <= day && day <= b)) facts.ramadan = true;
  }
  if (dom >= 25 || dom <= 2) facts.payday_window = true; // most salaries land 25th–1st
  else if (dom >= 15 && dom <= 22) facts.mid_to_late_month = 'before payday (usually slower)';
  return facts;
}
