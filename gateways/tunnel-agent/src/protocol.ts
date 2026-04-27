/**
 * Binary frame protocol constants and helpers.
 *
 * Mirrors the server-side TunnelBroker wire format:
 *   4-byte header:
 *     byte 0  : message type  (OPEN=1, DATA=2, CLOSE=3, PING=4, PONG=5, HEARTBEAT=6, CERT_RENEW=7)
 *     byte 1  : flags         (reserved, set to 0)
 *     bytes 2-3 : streamId   (uint16 big-endian)
 *   followed by payload (variable length, 0 bytes for OPEN/CLOSE/PING/PONG)
 */

export const MsgType = {
  OPEN:       1,
  DATA:       2,
  CLOSE:      3,
  PING:       4,
  PONG:       5,
  HEARTBEAT:  6,
  CERT_RENEW: 7,
} as const;

export type MsgTypeValue = typeof MsgType[keyof typeof MsgType];

export const HEADER_SIZE = 4;
export const MAX_FRAME_PAYLOAD_SIZE = 10 * 1024 * 1024;

export interface TunnelFrame {
  type: number;
  streamId: number;
  payload: Buffer;
}

export function isKnownMsgType(type: number): type is MsgTypeValue {
  return Object.values(MsgType).includes(type as MsgTypeValue);
}

/** Build a binary frame matching the TunnelBroker wire format. */
export function buildFrame(type: MsgTypeValue, streamId: number, payload?: Buffer): Buffer {
  const body = payload ?? Buffer.alloc(0);
  if (body.length > MAX_FRAME_PAYLOAD_SIZE) {
    throw new RangeError(`frame payload exceeds ${MAX_FRAME_PAYLOAD_SIZE} bytes`);
  }
  const frame = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  frame[0] = type;
  frame[1] = 0; // flags
  frame.writeUInt16BE(streamId, 2);
  body.copy(frame, HEADER_SIZE);
  return frame;
}

/** Parse a binary frame. Returns null if the buffer is too short or too large. */
export function parseFrame(buf: Buffer): TunnelFrame | null {
  if (buf.length < HEADER_SIZE) return null;
  if (buf.length - HEADER_SIZE > MAX_FRAME_PAYLOAD_SIZE) return null;
  const type = buf[0] as MsgTypeValue;
  const streamId = buf.readUInt16BE(2);
  const payload = buf.subarray(HEADER_SIZE);
  return { type, streamId, payload };
}
