// web/functions/_shared/vapid.test.ts
import { describe, it, expect } from 'vitest';
import { createVapidAuthHeader, extractJwtParts, decodeJwtPayload, importVapidPublicKeyForVerification } from './vapid';

// A throwaway VAPID keypair generated solely for this test file -- not used
// anywhere in the deployed app.
const TEST_PRIVATE_JWK = JSON.stringify({
  kty: 'EC',
  crv: 'P-256',
  x: 'XZbh3qh2JPdgI6c09WA6w8sXz2DIKFBD6C4wR04hgqc',
  y: 'sY1cOG614iI0YD3fTUC1ixtmdA5IOeL92sEFARQZXg0',
  d: 'jXr8vPqYXLgBTHdT5US2B-1-lNE07YHlMEj-cWg8EO0',
});
const TEST_PUBLIC_KEY = 'BF2W4d6odiT3YCOnNPVgOsPLF89gyChQQ-guMEdOIYKnsY1cOG614iI0YD3fTUC1ixtmdA5IOeL92sEFARQZXg0';
const TEST_SUBJECT = 'mailto:test@example.com';

async function verifyJwtSignature(jwt: string, publicKeyBase64Url: string): Promise<boolean> {
  const [header, payload, signature] = jwt.split('.');
  const key = await importVapidPublicKeyForVerification(publicKeyBase64Url);
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sigBytes = Uint8Array.from(atob(signature!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, data);
}

describe('VAPID auth header', () => {
  it('produces a well-formed "vapid t=..., k=..." header', async () => {
    const header = await createVapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123', TEST_PRIVATE_JWK, TEST_PUBLIC_KEY, TEST_SUBJECT);

    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    const { jwt, publicKey } = extractJwtParts(header);
    expect(publicKey).toBe(TEST_PUBLIC_KEY);
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('sets the JWT audience to the push endpoint origin, not the full URL', async () => {
    const header = await createVapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123?x=1', TEST_PRIVATE_JWK, TEST_PUBLIC_KEY, TEST_SUBJECT);
    const { jwt } = extractJwtParts(header);
    const payload = decodeJwtPayload(jwt);

    expect(payload.aud).toBe('https://fcm.googleapis.com');
  });

  it('sets an expiry within the recommended 12-24h window', async () => {
    const now = 1_700_000_000_000;
    const header = await createVapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123', TEST_PRIVATE_JWK, TEST_PUBLIC_KEY, TEST_SUBJECT, now);
    const { jwt } = extractJwtParts(header);
    const payload = decodeJwtPayload(jwt);

    expect(payload.exp).toBe(Math.floor(now / 1000) + 12 * 60 * 60);
  });

  it('produces a signature that verifies against the corresponding public key', async () => {
    const header = await createVapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123', TEST_PRIVATE_JWK, TEST_PUBLIC_KEY, TEST_SUBJECT);
    const { jwt } = extractJwtParts(header);

    expect(await verifyJwtSignature(jwt, TEST_PUBLIC_KEY)).toBe(true);
  });

  it('fails verification against a different public key', async () => {
    const otherPublicKey = 'BKFBAe2V9223S8RdYNqZ2PcGMKgL8h0R7gjgCERvn91T7BRY8LcgcphIMz650nAYRD0hGYch3swZIbpAm9kNedU'; // a real, different P-256 keypair's public key
    const header = await createVapidAuthHeader('https://fcm.googleapis.com/fcm/send/abc123', TEST_PRIVATE_JWK, TEST_PUBLIC_KEY, TEST_SUBJECT);
    const { jwt } = extractJwtParts(header);

    expect(await verifyJwtSignature(jwt, otherPublicKey)).toBe(false);
  });
});
