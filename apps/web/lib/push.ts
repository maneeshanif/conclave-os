import { api } from './api';

/** The key a browser subscribes with arrives as URL-safe base64; the subscribe call wants bytes. */
export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

export interface PushClient {
  state(): Promise<PushState>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}

/** The real thing, on this browser's service worker and push manager. */
export const browserPush: PushClient = {
  async state() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  },
  async enable() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications were not allowed on this device.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api.pushKey();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
    await api.pushSubscribe(sub.toJSON());
  },
  async disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  },
};
