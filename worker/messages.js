// Push / notification-centre wording, in each user's language (profiles.preferred_language).
// One summary per person per upload: the outlets of theirs that were flagged and not pushed yet.

const T = {
  title: {
    en: ['📉 Sales below normal · {n} outlet', '📉 Sales below normal · {n} outlets'],
    ms: ['📉 Jualan di bawah biasa · {n} outlet', '📉 Jualan di bawah biasa · {n} outlet'],
    zh: ['📉 销售低于正常 · {n} 家分店', '📉 销售低于正常 · {n} 家分店'],
    my: ['📉 ရောင်းအား ပုံမှန်အောက် · ဆိုင်ခွဲ {n} ခု', '📉 ရောင်းအား ပုံမှန်အောက် · ဆိုင်ခွဲ {n} ခု'],
  },
  drop: {
    en: '{code} {outlet} {date}: RM{net} ({pct}% of usual RM{exp})',
    ms: '{code} {outlet} {date}: RM{net} ({pct}% daripada biasa RM{exp})',
    zh: '{code} {outlet} {date}：RM{net}（平时 RM{exp} 的 {pct}%）',
    my: '{code} {outlet} {date}: RM{net} (ပုံမှန် RM{exp} ၏ {pct}%)',
  },
  none: {
    en: '{code} {outlet} {date}: no sales in the report (usual RM{exp})',
    ms: '{code} {outlet} {date}: tiada jualan dalam laporan (biasa RM{exp})',
    zh: '{code} {outlet} {date}：报表中没有销售（平时 RM{exp}）',
    my: '{code} {outlet} {date}: အစီရင်ခံစာတွင် ရောင်းအား မရှိ (ပုံမှန် RM{exp})',
  },
  more: { en: '+{n} more', ms: '+{n} lagi', zh: '另有 {n} 个', my: 'နောက်ထပ် {n} ခု' },
};

const LANGS = ['en', 'ms', 'zh', 'my'];
const pick = (lang) => (LANGS.includes(lang) ? lang : 'en');
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const money = (v) => Math.round(Number(v) || 0).toLocaleString('en-MY');
const dm = (ymd) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d}/${m}`;
};

// list: [{ code, name, business_date, kind, net_sales, expected, pct_of_expected }] (worst first)
export function summary(list, lang, max = 3) {
  const l = pick(lang);
  const outlets = new Set(list.map((e) => e.code)).size;
  const title = fill(T.title[l][outlets === 1 ? 0 : 1], { n: outlets });
  const lines = list.slice(0, max).map((e) =>
    fill(T[e.kind === 'no_sales' ? 'none' : 'drop'][l], {
      code: e.code, outlet: String(e.name || '').replace(/^US Pizza /, ''), date: dm(e.business_date),
      net: money(e.net_sales), exp: money(e.expected), pct: e.pct_of_expected,
    })
  );
  if (list.length > max) lines.push(fill(T.more[l], { n: list.length - max }));
  return { title, body: lines.join('\n') };
}
