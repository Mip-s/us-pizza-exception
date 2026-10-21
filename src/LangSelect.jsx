import { useState } from 'react';
import { supabase } from './supabase.js';
import { LANGS, LANGUAGE_NAMES, getLang, setLang, t } from './i18n.js';

// Language picker (same setting as the hub's). Switches the screens at once, then saves it to the
// profile so every module, device and push message follows it.
export default function LangSelect() {
  const [err, setErr] = useState('');
  const change = async (lang) => {
    setLang(lang);
    const { error } = await supabase.rpc('set_my_language', { p_language: lang });
    setErr(error ? error.message : '');
  };
  return (
    <select
      className="lang-select"
      value={getLang()}
      onChange={(e) => change(e.target.value)}
      aria-label={t('Language')}
      title={err || t('Language for screens and the messages you receive')}
    >
      {LANGS.map((code) => (
        <option key={code} value={code} lang={code}>
          {LANGUAGE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}
