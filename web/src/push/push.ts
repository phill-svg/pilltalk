// web/src/push/push.ts
//
// Client-side push subscription management. Kept separate from main.ts's
// wiring for the same reason as every other module here, but relies
// entirely on live browser APIs (ServiceWorker, PushManager, Notification)
// so -- like main.ts -- it's verified by manual/browser testing rather than
// a unit test suite; there's nothing meaningful to assert against real
// permission prompts and real push delivery without a live device.

const VAPID_PUBLIC_KEY = 'BF2W4d6odiT3YCOnNPVgOsPLF89gyChQQ-guMEdOIYKnsY1cOG614iI0YD3fTUC1ixtmdA5IOeL92sEFARQZXg0';

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64Url.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function isPushEnabled(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return false;
  return (await registration.pushManager.getSubscription()) !== null;
}

export async function enablePush(pubkey: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, subscription: subscription.toJSON() }),
  });
  return true;
}

export function notifyPeer(recipientPubkey: string): void {
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientPubkey }),
  }).catch(() => {});
}
