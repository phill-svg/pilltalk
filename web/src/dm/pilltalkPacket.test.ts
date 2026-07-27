// web/src/dm/pilltalkPacket.test.ts
import { describe, it, expect } from 'vitest';
import { encodePilltalk1Message, decodePilltalk1 } from './pilltalkPacket';

function pad7(data: Uint8Array, toSize: number): Uint8Array {
  const padding = toSize - data.length;
  if (padding <= 0 || padding > 255) return data;
  const out = new Uint8Array(toSize);
  out.set(data, 0);
  out.fill(padding, data.length);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Hand-builds a v1 packet matching BinaryProtocol.swift's layout, so tests
// exercise the decoder against bytes it did not itself produce.
function buildV1Packet(opts: {
  payload: Uint8Array;
  hasRecipient?: boolean;
  hasSignature?: boolean;
  type?: number;
}): Uint8Array {
  const type = opts.type ?? 0x11;
  const senderId = new Uint8Array(8).fill(0xaa);
  const recipientId = opts.hasRecipient ? new Uint8Array(8).fill(0xbb) : null;
  const signature = opts.hasSignature ? new Uint8Array(64).fill(0xcc) : null;

  let flags = 0;
  if (recipientId) flags |= 0x01;
  if (signature) flags |= 0x02;

  const header = new Uint8Array(14);
  header[0] = 1;
  header[1] = type;
  header[2] = 7;
  const ts = BigInt(1_700_000_000_000);
  for (let i = 0; i < 8; i++) header[3 + i] = Number((ts >> BigInt(56 - i * 8)) & 0xffn);
  header[11] = flags;
  header[12] = (opts.payload.length >> 8) & 0xff;
  header[13] = opts.payload.length & 0xff;

  const parts = [header, senderId, ...(recipientId ? [recipientId] : []), opts.payload, ...(signature ? [signature] : [])];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function buildPrivateMessagePayload(messageId: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const idBytes = enc.encode(messageId);
  const contentBytes = enc.encode(content);
  const out = new Uint8Array(1 + 2 + idBytes.length + 2 + contentBytes.length);
  let o = 0;
  out[o++] = 0x01; // NoisePayloadType.privateMessage
  out[o++] = 0x00; // TLV type: messageID
  out[o++] = idBytes.length;
  out.set(idBytes, o);
  o += idBytes.length;
  out[o++] = 0x01; // TLV type: content
  out[o++] = contentBytes.length;
  out.set(contentBytes, o);
  return out;
}

describe('encodePilltalk1Message / decodePilltalk1', () => {
  it('round-trips a message through the web app itself', async () => {
    const encoded = encodePilltalk1Message('hello from web', 'msg-123');
    expect(encoded.startsWith('pilltalk1:')).toBe(true);

    const decoded = await decodePilltalk1(encoded);
    expect(decoded).toEqual({ kind: 'message', messageId: 'msg-123', content: 'hello from web' });
  });

  it('decodes a hand-built packet with no recipient/signature (matches the iOS/Android geohash-DM shape)', async () => {
    const payload = buildPrivateMessagePayload('abc-1', 'hey there');
    const packet = buildV1Packet({ payload });
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(packet));
    expect(decoded).toEqual({ kind: 'message', messageId: 'abc-1', content: 'hey there' });
  });

  it('decodes a hand-built packet that includes a recipient ID (matches the iOS/Android favorites-DM shape)', async () => {
    const payload = buildPrivateMessagePayload('abc-2', 'with recipient');
    const packet = buildV1Packet({ payload, hasRecipient: true });
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(packet));
    expect(decoded).toEqual({ kind: 'message', messageId: 'abc-2', content: 'with recipient' });
  });

  it('decodes a hand-built packet that includes a trailing signature', async () => {
    const payload = buildPrivateMessagePayload('abc-3', 'signed');
    const packet = buildV1Packet({ payload, hasSignature: true });
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(packet));
    expect(decoded).toEqual({ kind: 'message', messageId: 'abc-3', content: 'signed' });
  });

  it('decodes a PKCS#7-padded packet (matches the native apps sending toBinaryData(padding: true))', async () => {
    const payload = buildPrivateMessagePayload('abc-4', 'padded');
    const packet = buildV1Packet({ payload });
    const padded = pad7(packet, 256);
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(padded));
    expect(decoded).toEqual({ kind: 'message', messageId: 'abc-4', content: 'padded' });
  });

  it('returns {kind: "other"} for a non-privateMessage payload type (e.g. a delivery ack)', async () => {
    const enc = new TextEncoder();
    const messageId = enc.encode('abc-5');
    const payload = new Uint8Array(1 + messageId.length);
    payload[0] = 0x03; // NoisePayloadType.delivered
    payload.set(messageId, 1);
    const packet = buildV1Packet({ payload });
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(packet));
    expect(decoded).toEqual({ kind: 'other' });
  });

  it('returns null for plain text (older/web-only DM content), so callers fall back to it verbatim', async () => {
    expect(await decodePilltalk1('just a plain message')).toBeNull();
  });

  it('returns {kind: "other"} for malformed base64 after a valid prefix, not a throw', async () => {
    await expect(decodePilltalk1('pilltalk1:not-valid-base64!!!')).resolves.toEqual({ kind: 'other' });
  });

  it('returns {kind: "other"} for a truncated/corrupt packet', async () => {
    const decoded = await decodePilltalk1('pilltalk1:' + base64UrlEncode(new Uint8Array([1, 2, 3])));
    expect(decoded).toEqual({ kind: 'other' });
  });
});
