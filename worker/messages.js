// Push / notification-centre wording, in each user's language (profiles.preferred_language).
// One ranked summary per person per upload: their exceptions not pushed yet, most RM at stake first.

const T = {
  title: {
    en: ['🚨 Exceptions · {n} outlet', '🚨 Exceptions · {n} outlets'],
    ms: ['🚨 Pengecualian · {n} outlet', '🚨 Pengecualian · {n} outlet'],
    zh: ['🚨 异常 · {n} 家分店', '🚨 异常 · {n} 家分店'],
    my: ['🚨 ချွင်းချက်များ · ဆိုင်ခွဲ {n} ခု', '🚨 ချွင်းချက်များ · ဆိုင်ခွဲ {n} ခု'],
  },
  sales_drop: {
    en: '{code} {outlet} {date}: sales RM{net} ({pct}% of usual RM{exp})',
    ms: '{code} {outlet} {date}: jualan RM{net} ({pct}% daripada biasa RM{exp})',
    zh: '{code} {outlet} {date}：销售 RM{net}（平时 RM{exp} 的 {pct}%）',
    my: '{code} {outlet} {date}: ရောင်းအား RM{net} (ပုံမှန် RM{exp} ၏ {pct}%)',
  },
  no_sales: {
    en: '{code} {outlet} {date}: no sales in the report (usual RM{exp})',
    ms: '{code} {outlet} {date}: tiada jualan dalam laporan (biasa RM{exp})',
    zh: '{code} {outlet} {date}：报表中没有销售（平时 RM{exp}）',
    my: '{code} {outlet} {date}: အစီရင်ခံစာတွင် ရောင်းအား မရှိ (ပုံမှန် RM{exp})',
  },
  discount_spike: {
    en: '{code} {outlet} {date}: discounts {value}% of sales (usual {usual}%, +RM{impact})',
    ms: '{code} {outlet} {date}: diskaun {value}% jualan (biasa {usual}%, +RM{impact})',
    zh: '{code} {outlet} {date}：折扣占销售 {value}%（平时 {usual}%，多 RM{impact}）',
    my: '{code} {outlet} {date}: လျှော့စျေး ရောင်းအား၏ {value}% (ပုံမှန် {usual}%, +RM{impact})',
  },
  void_spike: {
    en: '{code} {outlet} {date}: RM{value} voided in {bills} bills (usual RM{usual})',
    ms: '{code} {outlet} {date}: RM{value} dibatalkan dalam {bills} bil (biasa RM{usual})',
    zh: '{code} {outlet} {date}：作废 RM{value}，共 {bills} 张单（平时 RM{usual}）',
    my: '{code} {outlet} {date}: ဘောက်ချာ {bills} စောင်တွင် RM{value} ပယ်ဖျက် (ပုံမှန် RM{usual})',
  },
  likely: { en: 'likely: {tag}', ms: 'kemungkinan: {tag}', zh: '可能：{tag}', my: 'ဖြစ်နိုင်သည်- {tag}' },
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

// most RM at stake first (sales drops without impact: how far below expected)
export const rank = (list) => [...list].sort((a, b) => (Number(b.impact) || 0) - (Number(a.impact) || 0));

// list: [{ code, name, business_date, kind, net_sales, expected, pct_of_expected, value, usual, impact, bills }]
export function summary(list, lang, max = 4) {
  const l = pick(lang);
  const ranked = rank(list);
  const outlets = new Set(ranked.map((e) => e.code)).size;
  const title = fill(T.title[l][outlets === 1 ? 0 : 1], { n: outlets });
  const lines = ranked.slice(0, max).map((e) =>
    fill((T[e.kind] || T.sales_drop)[l], {
      code: e.code, outlet: String(e.name || '').replace(/^US Pizza /, ''), date: dm(e.business_date),
      net: money(e.net_sales), exp: money(e.expected), pct: e.pct_of_expected,
      value: e.kind === 'void_spike' ? money(e.value) : e.value, usual: e.kind === 'void_spike' ? money(e.usual) : e.usual,
      impact: money(e.impact), bills: e.bills ?? '?',
    }) + (e.cause_tag ? ` — ${fill(T.likely[l], { tag: e.causes_i18n?.[l]?.tag || e.cause_tag })}` : '')
  );
  if (ranked.length > max) lines.push(fill(T.more[l], { n: ranked.length - max }));
  return { title, body: lines.join('\n') };
}
