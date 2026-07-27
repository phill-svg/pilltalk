// web/src/dm/pilltalkPacket.ts
//
// Wire-compatible encoder/decoder for the "pilltalk1:" embedded packet
// format the iOS and Android apps wrap around every DM rumor's content
// (originally designed for their Bluetooth-mesh transport, reused verbatim
// for Nostr DMs). Without this, a plain-text rumor content field -- which
// is all this web app used to send -- is unparseable by the native apps,
// and the native apps' own packets show up here as raw binary garbage
// instead of message text. Format reverse-engineered from
// pilltalk/localPackages/BitFoundation/Sources/BitFoundation/{PilltalkPacket,
// BinaryProtocol, MessagePadding, CompressionUtil}.swift and
// pilltalk/Protocols/Packets.swift (PrivateMessagePacket TLV).

const NOISE_PAYLOAD_TYPE_PRIVATE_MESSAGE = 0x01;
const MESSAGE_TYPE_NOISE_ENCRYPTED = 0x11;

const FLAG_HAS_RECIPIENT = 0x01;
const FLAG_HAS_SIGNATURE = 0x02;
const FLAG_IS_COMPRESSED = 0x04;
const FLAG_HAS_ROUTE = 0x08;

const SENDER_ID_SIZE = 8;
const RECIPIENT_ID_SIZE = 8;
const SIGNATURE_SIZE = 64;
const V1_HEADER_SIZE = 14;
const V2_HEADER_SIZE = 16;

const TLV_MESSAGE_ID = 0x00;
const TLV_CONTENT = 0x01;

function randomSenderId(): Uint8Array {
  const id = new Uint8Array(SENDER_ID_SIZE);
  crypto.getRandomValues(id);
  return id;
}

function encodeTLV(entries: Array<[number, Uint8Array]>): Uint8Array {
  const bytes: number[] = [];
  for (const [type, value] of entries) {
    if (value.length > 255) throw new Error('pilltalkPacket: TLV value too long');
    bytes.push(type, value.length, ...value);
  }
  return new Uint8Array(bytes);
}

function decodeTLV(data: Uint8Array): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  let offset = 0;
  while (offset + 2 <= data.length) {
    const type = data[offset]!;
    const length = data[offset + 1]!;
    offset += 2;
    if (offset + length > data.length) break;
    result.set(type, data.slice(offset, offset + length));
    offset += length;
  }
  return result;
}

// PKCS#7-style padding removal, matching MessagePadding.unpad: only strips
// the tail if every one of the last N bytes equals N (the pad-length
// marker); otherwise the data is returned unchanged (it wasn't padded).
function unpadPkcs7(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data;
  const last = data[data.length - 1]!;
  if (last === 0 || last > data.length) return data;
  const start = data.length - last;
  for (let i = start; i < data.length; i++) {
    if (data[i] !== last) return data;
  }
  return data.slice(0, start);
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encodes a chat message as a "pilltalk1:"-prefixed packet the iOS/Android
 * apps' decoder accepts: v1, unpadded, uncompressed, unsigned, no recipient
 * ID and no route -- the minimal shape their tolerant decoder still parses
 * (padding/compression/signature/recipient are all optional on the wire).
 */
export function encodePilltalk1Message(content: string, messageId: string): string {
  const encoder = new TextEncoder();
  const tlv = encodeTLV([
    [TLV_MESSAGE_ID, encoder.encode(messageId)],
    [TLV_CONTENT, encoder.encode(content)],
  ]);
  const payload = new Uint8Array(1 + tlv.length);
  payload[0] = NOISE_PAYLOAD_TYPE_PRIVATE_MESSAGE;
  payload.set(tlv, 1);
  if (payload.length > 0xffff) throw new Error('pilltalkPacket: payload too long for v1 packet');

  const senderId = randomSenderId();
  const timestamp = BigInt(Date.now());

  const header = new Uint8Array(V1_HEADER_SIZE);
  header[0] = 1; // version
  header[1] = MESSAGE_TYPE_NOISE_ENCRYPTED;
  header[2] = 7; // ttl
  for (let i = 0; i < 8; i++) {
    header[3 + i] = Number((timestamp >> BigInt(56 - i * 8)) & 0xffn);
  }
  header[11] = 0; // flags: no recipient / signature / compression / route
  header[12] = (payload.length >> 8) & 0xff;
  header[13] = payload.length & 0xff;

  const packet = new Uint8Array(header.length + senderId.length + payload.length);
  packet.set(header, 0);
  packet.set(senderId, header.length);
  packet.set(payload, header.length + senderId.length);

  return 'pilltalk1:' + base64UrlEncode(packet);
}

export type DecodedPilltalk1 = { kind: 'message'; messageId: string; content: string } | { kind: 'other' };

interface DecodedPacket {
  type: number;
  payload: Uint8Array;
}

async function decodePacketCore(data: Uint8Array): Promise<DecodedPacket | null> {
  if (data.length < V1_HEADER_SIZE + SENDER_ID_SIZE) return null;
  const version = data[0];
  if (version !== 1 && version !== 2) return null;
  const headerSize = version === 2 ? V2_HEADER_SIZE : V1_HEADER_SIZE;
  if (data.length < headerSize + SENDER_ID_SIZE) return null;

  const type = data[1]!;
  let offset = 11; // version(1) + type(1) + ttl(1) + timestamp(8)
  const flags = data[offset]!;
  offset += 1;
  const hasRecipient = (flags & FLAG_HAS_RECIPIENT) !== 0;
  const hasSignature = (flags & FLAG_HAS_SIGNATURE) !== 0;
  const isCompressed = (flags & FLAG_IS_COMPRESSED) !== 0;
  const hasRoute = version >= 2 && (flags & FLAG_HAS_ROUTE) !== 0;

  let payloadLength: number;
  if (version === 2) {
    if (offset + 4 > data.length) return null;
    payloadLength = (data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!;
    offset += 4;
  } else {
    if (offset + 2 > data.length) return null;
    payloadLength = (data[offset]! << 8) | data[offset + 1]!;
    offset += 2;
  }
  if (payloadLength < 0) return null;

  if (offset + SENDER_ID_SIZE > data.length) return null;
  offset += SENDER_ID_SIZE;

  if (hasRecipient) {
    if (offset + RECIPIENT_ID_SIZE > data.length) return null;
    offset += RECIPIENT_ID_SIZE;
  }

  if (hasRoute) {
    if (offset >= data.length) return null;
    const routeCount = data[offset]!;
    offset += 1 + routeCount * SENDER_ID_SIZE;
    if (offset > data.length) return null;
  }

  let payload: Uint8Array;
  if (isCompressed) {
    const lengthFieldBytes = version === 2 ? 4 : 2;
    if (payloadLength < lengthFieldBytes) return null;
    let originalSize: number;
    if (version === 2) {
      if (offset + 4 > data.length) return null;
      originalSize = (data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!;
      offset += 4;
    } else {
      if (offset + 2 > data.length) return null;
      originalSize = (data[offset]! << 8) | data[offset + 1]!;
      offset += 2;
    }
    const compressedSize = payloadLength - lengthFieldBytes;
    if (compressedSize <= 0 || offset + compressedSize > data.length) return null;
    const compressed = data.slice(offset, offset + compressedSize);
    offset += compressedSize;
    try {
      payload = await inflateZlib(compressed);
    } catch {
      return null;
    }
    if (payload.length !== originalSize) return null;
  } else {
    if (offset + payloadLength > data.length) return null;
    payload = data.slice(offset, offset + payloadLength);
    offset += payloadLength;
  }

  if (hasSignature) {
    if (offset + SIGNATURE_SIZE > data.length) return null;
  }

  return { type, payload };
}

async function decodePacket(raw: Uint8Array): Promise<DecodedPacket | null> {
  const direct = await decodePacketCore(raw);
  if (direct) return direct;
  const unpadded = unpadPkcs7(raw);
  if (unpadded.length === raw.length) return null;
  return decodePacketCore(unpadded);
}

/**
 * Decodes a "pilltalk1:"-prefixed packet from the iOS/Android apps. Returns
 * null when `raw` isn't a pilltalk1 packet at all -- the caller should fall
 * back to treating `raw` as plain text (older/web-only DM content).
 */
export async function decodePilltalk1(raw: string): Promise<DecodedPilltalk1 | null> {
  if (!raw.startsWith('pilltalk1:')) return null;
  let packet: Uint8Array;
  try {
    packet = base64UrlDecode(raw.slice('pilltalk1:'.length));
  } catch {
    return { kind: 'other' };
  }

  const parsed = await decodePacket(packet);
  if (!parsed) return { kind: 'other' };
  if (parsed.type !== MESSAGE_TYPE_NOISE_ENCRYPTED || parsed.payload.length === 0) return { kind: 'other' };

  const payloadType = parsed.payload[0]!;
  if (payloadType !== NOISE_PAYLOAD_TYPE_PRIVATE_MESSAGE) return { kind: 'other' };

  const tlv = decodeTLV(parsed.payload.slice(1));
  const messageIdBytes = tlv.get(TLV_MESSAGE_ID);
  const contentBytes = tlv.get(TLV_CONTENT);
  if (!messageIdBytes || !contentBytes) return { kind: 'other' };

  const decoder = new TextDecoder();
  return { kind: 'message', messageId: decoder.decode(messageIdBytes), content: decoder.decode(contentBytes) };
}
