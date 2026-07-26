// web/functions/api/notify.ts
//
// Sends an EMPTY web push (no data payload) to every subscription registered
// for a pubkey, to wake up that device's browser. The sender's browser calls
// this right after publishing a gift-wrapped DM. This endpoint never sees
// message content -- only "recipientPubkey should be pinged now" -- and the
// push payload itself carries nothing either, matching Signal's silent-push
// pattern: the woken-up tab fetches/decrypts the real message itself over
// its existing relay connection.

import { createVapidAuthHeader } from '../_shared/vapid';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Env {
  PUSH_SUBSCRIPTIONS: KVNamespace;
  VAPID_PRIVATE_KEY_JWK: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const PUSH_TTL_SECONDS = 86400; // 24h -- how long the push service should keep retrying delivery

function isValidPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  let body: { recipientPubkey?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  if (!isValidPubkey(body.recipientPubkey)) {
    return new Response('invalid payload', { status: 400 });
  }

  const key = `sub:${body.recipientPubkey}`;
  const raw = await context.env.PUSH_SUBSCRIPTIONS.get(key);
  if (!raw) return new Response(null, { status: 204 });

  const subscriptions: PushSubscriptionJson[] = JSON.parse(raw);
  const stillValid: PushSubscriptionJson[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const authHeader = await createVapidAuthHeader(sub.endpoint, context.env.VAPID_PRIVATE_KEY_JWK, context.env.VAPID_PUBLIC_KEY, context.env.VAPID_SUBJECT);
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: { Authorization: authHeader, TTL: String(PUSH_TTL_SECONDS) },
        });
        // 404/410 mean the push service considers this subscription gone
        // for good (user revoked permission, uninstalled, etc.) -- drop it.
        // Anything else (success, or a transient error) keeps it for next time.
        if (res.status !== 404 && res.status !== 410) stillValid.push(sub);
      } catch {
        stillValid.push(sub);
      }
    }),
  );

  if (stillValid.length !== subscriptions.length) {
    if (stillValid.length > 0) {
      await context.env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify(stillValid));
    } else {
      await context.env.PUSH_SUBSCRIPTIONS.delete(key);
    }
  }

  return new Response(null, { status: 204 });
}
