// web/functions/api/register.ts
//
// Stores a browser's push subscription under its PillTalk pubkey, so
// /api/notify knows which device(s) to wake up for that identity. Never
// sees message content -- only ever handles the subscription endpoint/keys
// the browser itself generated via PushManager.subscribe().

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  PUSH_SUBSCRIPTIONS: KVNamespace;
}

interface PagesContext {
  request: Request;
  env: Env;
}

interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const MAX_SUBSCRIPTIONS_PER_PUBKEY = 10;

function isValidPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isValidSubscription(value: unknown): value is PushSubscriptionJson {
  if (typeof value !== 'object' || value === null) return false;
  const sub = value as Record<string, unknown>;
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return false;
  const keys = sub.keys as Record<string, unknown> | undefined;
  return !!keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string';
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  let body: { pubkey?: unknown; subscription?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  if (!isValidPubkey(body.pubkey) || !isValidSubscription(body.subscription)) {
    return new Response('invalid payload', { status: 400 });
  }

  const key = `sub:${body.pubkey}`;
  const existingRaw = await context.env.PUSH_SUBSCRIPTIONS.get(key);
  const existing: PushSubscriptionJson[] = existingRaw ? JSON.parse(existingRaw) : [];
  const deduped = existing.filter((s) => s.endpoint !== (body.subscription as PushSubscriptionJson).endpoint);
  deduped.push(body.subscription as PushSubscriptionJson);
  const capped = deduped.slice(-MAX_SUBSCRIPTIONS_PER_PUBKEY);

  await context.env.PUSH_SUBSCRIPTIONS.put(key, JSON.stringify(capped));
  return new Response(null, { status: 204 });
}
