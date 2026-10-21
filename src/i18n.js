// UI language, shared by every US Pizza dashboard (same file in each repo — keep them in sync).
// The hub's picker saves the choice to profiles.preferred_language (so push messages follow it)
// and to localStorage 'ops.lang'. The hub and its modules (/uptime, /review, /maintenance, /grn)
// share one origin, so every open tab switches language at once.
//
// Usage: t('Sign out') — the English text is the key; translations live in ./strings.js.
//        t('{n} outlets', { n: 5 }) — {name} placeholders.
//        Call useLang() once in the root component so the tree re-renders when the language changes.
import { useEffect, useState } from 'react';
import STRINGS from './strings.js';

export const LANGS = ['en', 'ms', 'zh', 'my'];
export const LANGUAGE_NAMES = { en: 'English', ms: 'Bahasa Melayu', zh: '中文', my: 'မြန်မာ' };
const LOCALES = { en: 'en-MY', ms: 'ms-MY', zh: 'zh-MY', my: 'my-MM' };
const KEY = 'ops.lang';
const EVENT = 'ops-lang';

const read = () => {
  try {
    const l = localStorage.getItem(KEY);
    return LANGS.includes(l) ? l : 'en';
  } catch {
    return 'en';
  }
};

let current = read();
if (typeof document !== 'undefined') document.documentElement.lang = current;

const apply = (lang) => {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  window.dispatchEvent(new Event(EVENT));
};

if (typeof window !== 'undefined') {
  // Another tab (or the hub in another tab) changed it
  window.addEventListener('storage', (e) => e.key === KEY && apply(read()));
}

export const getLang = () => current;
export const locale = () => LOCALES[current];

export function setLang(lang) {
  const l = LANGS.includes(lang) ? lang : 'en';
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: this tab only */
  }
  apply(l);
}

// The saved profile setting wins over this device's last choice (null = not chosen yet: keep the device's)
export const syncLangFromProfile = (lang) => LANGS.includes(lang) && setLang(lang);

export function useLang() {
  const [lang, set] = useState(current);
  useEffect(() => {
    const on = () => set(current);
    window.addEventListener(EVENT, on);
    on();
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return lang;
}

export function t(en, vars) {
  let s = (current !== 'en' && STRINGS[current]?.[en]) || en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
