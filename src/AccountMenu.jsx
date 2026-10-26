import { useEffect, useRef, useState } from 'react';
import LangSelect from './LangSelect.jsx';
import { t } from './i18n.js';

// 23/10: the hub's account button (12/10) in every module — one button instead of name, language and sign out
// spread across the header. Opens a menu with alerts, language, change password (on the hub) and sign out.
// The dot on the avatar shows alerts on (green) / off (red) at a glance. Same file in every module repo.
//
// push: usePush() from hooks.js. Modules can only turn alerts on; stopping them is done on the hub.
export default function AccountMenu({ name, detail, push, hubHome, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const canPush = push.supported || push.needsIosInstall;
  const label = name || '?';

  return (
    <div className="account" ref={ref}>
      <button
        type="button"
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={t('Account')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-avatar" aria-hidden="true">
          {label.charAt(0).toUpperCase()}
          {canPush && <span className={`avatar-dot ${push.subscribed ? 'is-on' : ''}`} />}
        </span>
        <span className="user-text">
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
        <span className="account-chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="account-menu" id="account-menu" role="menu" aria-label={t('Account')}>
          <div className="menu-head">
            <span className="user-avatar" aria-hidden="true">{label.charAt(0).toUpperCase()}</span>
            <span className="user-text">
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </div>
          {canPush && (
            <div className="menu-row">
              <span className="menu-label">
                <span className={`menu-dot ${push.subscribed ? 'is-on' : ''}`} aria-hidden="true" />
                {push.subscribed ? t('Alerts on') : t('Alerts off')}
              </span>
              {!push.subscribed && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-action is-primary"
                  disabled={push.busy || push.needsIosInstall}
                  title={push.needsIosInstall ? t('Add to Home Screen first (iOS requirement)') : push.error || undefined}
                  onClick={() => {
                    setOpen(false);
                    push.enable();
                  }}
                >
                  {push.busy ? t('Working…') : push.needsIosInstall ? t('Enable alerts (install first)') : t('Turn on alerts')}
                </button>
              )}
            </div>
          )}
          <label className="menu-row">
            <span className="menu-label">{t('Language')}</span>
            <LangSelect />
          </label>
          <a role="menuitem" className="menu-item" href={`${hubHome}account/password`}>
            {t('Change password')}
          </a>
          <button type="button" role="menuitem" className="menu-item is-danger" onClick={onSignOut}>
            {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

// 23/10: "← Back", same as the hub's notification centre: back to the previous page when it was one of ours,
// otherwise to the hub home (opened from a push, a bookmark or another site).
export function BackLink({ hubHome }) {
  const back = (e) => {
    let ours = false;
    try {
      ours = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      /* no referrer */
    }
    if (ours && window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  };
  return (
    <a className="back-btn" href={hubHome} onClick={back}>
      {t('← Back')}
    </a>
  );
}
