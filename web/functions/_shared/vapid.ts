// web/functions/_shared/vapid.ts
//
// Minimal VAPID (RFC 8292) auth header builder for sending EMPTY web push
// messages -- no payload, so no need to implement the aes128gcm payload
// encryption scheme (RFC 8291) at all. The push service is just told "wake
// this subscription up"; the app then fetches whatever changed over the
// existing Nostr relay connection once it's running, the same way Signal's
// silent push works. This keeps the push payload (and therefore whatever
// Apple/Google/Mozilla's push infra can see) completely empty.
//
// Uses only standard Web Crypto / Web platform APIs (no Node-only or
// Workers-only globals), so this module works unmodified both inside a
// Cloudflare Pages Function and under Vitest.

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

export async function importVapidPrivateKey(privateKeyJwkJson: string): Promise<CryptoKey> {
  const jwk = JSON.parse(privateKeyJwkJson);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function importVapidPublicKeyForVerification(publicKeyBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(publicKeyBase64Url);
  return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Builds the `Authorization: vapid t=<jwt>, k=<publicKey>` header value for
 * a push request to the given subscription endpoint, per RFC 8292.
 */
export async function createVapidAuthHeader(
  endpoint: string,
  privateKeyJwkJson: string,
  publicKeyBase64Url: string,
  subject: string,
  now: number = Date.now(),
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const nowSeconds = Math.floor(now / 1000);
  const payload = { aud: audience, exp: nowSeconds + 12 * 60 * 60, sub: subject };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;

  const key = await importVapidPrivateKey(privateKeyJwkJson);
  // WebCrypto's ECDSA signatures are raw IEEE-P1363 (r||s), which is exactly
  // the format JOSE/JWT ES256 requires -- no DER-to-raw conversion needed.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  const jwt = `${unsigned}.${encodedSignature}`;
  return `vapid t=${jwt}, k=${publicKeyBase64Url}`;
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]!));
  return JSON.parse(payloadJson);
}

export function extractJwtParts(authHeader: string): { jwt: string; publicKey: string } {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(authHeader);
  if (!match) throw new Error('malformed VAPID auth header');
  return { jwt: match[1]!, publicKey: match[2]! };
}
