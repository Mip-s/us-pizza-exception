// Same header tools as the POS Uptime Monitor: push alerts toggle, new-version check,
// pull-to-refresh. Kept together so the two dashboards behave the same.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { t } from './i18n.js';

// Same VAPID public key as the uptime monitor (the Workers sign pushes with the matching private key).
export const VAPID_PUBLIC_KEY = 'BGLP1a0KXimha7M4046OLzimiAVw5rmFca8RGz__XPy-MCaUCQnXhbJ6ep7Mdr2TWESXuezQhndQB_qdyXQdgG0';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...window.atob(base64)].map((c) => c.charCodeAt(0)));
}

// ---------- Push alerts (one subscription per device, shared with the hub + uptime) ----------
export function usePush(session) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const needsIosInstall = isIos && !isStandalone;

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window;
    setSupported(ok);
    if (!ok) return;
    // Root service worker on purpose: inside the hub this is the hub's single worker,
    // so alerts from uptime and reviews arrive through one subscription.
    navigator.serviceWorker
      .register('/sw.js')
      .then(async (reg) => {
        const existing = await reg.pushManager.getSubscription();
        let matchesKey = !!existing;
        try {
          const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
          const used = existing?.options?.applicationServerKey ? new Uint8Array(existing.options.applicationServerKey) : null;
          if (used) matchesKey = used.length === current.length && used.every((b, i) => b === current[i]);
        } catch {
          /* older browsers don't expose options */
        }
        setSubscribed(!!existing && matchesKey);
      })
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  const enable = async () => {
    if (needsIosInstall) {
      setError(t('On iPhone, tap Share → "Add to Home Screen" first, then open the app from your Home Screen to enable alerts.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') {
        setError(t('Notification permission was not granted.'));
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', existing.endpoint);
        await existing.unsubscribe();
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const json = sub.toJSON();
      const { error: dbErr } = await supabase
        .from('push_subscriptions')
        .upsert({ user_id: session.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: 'endpoint' });
      if (dbErr) throw dbErr;
      setSubscribed(true);
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
      setError(t('Could not enable notifications. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  // No disable (9/10): alerts are required for the hub; a module can only turn them on.
  return { supported, subscribed, busy, error, needsIosInstall, enable };
}

// ---------- New version check ----------
// An open page (especially the installed phone app) keeps running old code after a deploy.
// Compare the script this page loaded with the one in the latest index.html.
export function useUpdateCheck() {
  const [updateReady, setUpdateReady] = useState(false);
  const check = useCallback(async () => {
    if (!import.meta.env.PROD) return false;
    try {
      const current = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
      if (!current) return false;
      // Fetch the app root (/review/), not /review/index.html — the assets layer redirects
      // index.html paths, which inside the hub lands on the hub's own page.
      const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
      if (!res.ok) return false;
      const latest = (await res.text()).match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
      const isNew = Boolean(latest && latest !== current);
      if (isNew) setUpdateReady(true);
      return isNew;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, 2 * 60 * 1000);
    // Coming back to the app: if a new version is out, load it straight away.
    const onVisible = async () => {
      if (document.visibilityState === 'visible' && (await check())) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  return { updateReady, check };
}

// ---------- Pull-to-refresh (phones) ----------
export const PULL_THRESHOLD = 70;

export function usePullToRefresh(onRefresh) {
  const [distance, setDistance] = useState(0);
  const ref = useRef({ startY: null, distance: 0 });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const onStart = (e) => {
      ref.current.startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      ref.current.distance = 0;
    };
    const onMove = (e) => {
      if (ref.current.startY === null) return;
      const dy = e.touches[0].clientY - ref.current.startY;
      if (dy <= 0 || window.scrollY > 0) {
        ref.current.distance = 0;
        setDistance(0);
        return;
      }
      const d = Math.min(dy * 0.5, 110);
      ref.current.distance = d;
      setDistance(d);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (ref.current.startY === null) return;
      const enough = ref.current.distance >= PULL_THRESHOLD;
      ref.current = { startY: null, distance: 0 };
      setDistance(0);
      if (enough) refreshRef.current();
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return distance;
}
