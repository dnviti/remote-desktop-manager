import { describe, it, expect } from 'vitest';
import { MsgType, buildFrame, parseFrame, HEADER_SIZE } from './protocol';

describe('protocol', () => {
  describe('buildFrame', () => {
    it('builds a PING frame with no payload', () => {
      const frame = buildFrame(MsgType.PING, 0);
      expect(frame.length).toBe(HEADER_SIZE);
      expect(frame[0]).toBe(MsgType.PING);
      expect(frame[1]).toBe(0); // flags
      expect(frame.readUInt16BE(2)).toBe(0); // streamId
    });

    it('builds a DATA frame with payload', () => {
      const payload = Buffer.from('hello');
      const frame = buildFrame(MsgType.DATA, 42, payload);
      expect(frame.length).toBe(HEADER_SIZE + payload.length);
      expect(frame[0]).toBe(MsgType.DATA);
      expect(frame.readUInt16BE(2)).toBe(42);
      expect(frame.slice(HEADER_SIZE).toString()).toBe('hello');
    });

    it('builds an OPEN frame with host:port payload', () => {
      const payload = Buffer.from('localhost:4822', 'utf8');
      const frame = buildFrame(MsgType.OPEN, 1, payload);
      expect(frame[0]).toBe(MsgType.OPEN);
      expect(frame.readUInt16BE(2)).toBe(1);
      expect(frame.slice(HEADER_SIZE).toString('utf8')).toBe('localhost:4822');
    });

    it('uses big-endian encoding for streamId', () => {
      const frame = buildFrame(MsgType.CLOSE, 0x0102);
      expect(frame[2]).toBe(0x01);
      expect(frame[3]).toBe(0x02);
    });
  });

  describe('parseFrame', () => {
    it('returns null for buffers shorter than HEADER_SIZE', () => {
      expect(parseFrame(Buffer.alloc(3))).toBeNull();
      expect(parseFrame(Buffer.alloc(0))).toBeNull();
    });

    it('round-trips a DATA frame', () => {
      const payload = Buffer.from('test data');
      const frame = buildFrame(MsgType.DATA, 7, payload);
      const parsed = parseFrame(frame);
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(MsgType.DATA);
      expect(parsed!.streamId).toBe(7);
      expect(parsed!.payload.toString()).toBe('test data');
    });

    it('round-trips a CLOSE frame with empty payload', () => {
      const frame = buildFrame(MsgType.CLOSE, 99);
      const parsed = parseFrame(frame);
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(MsgType.CLOSE);
      expect(parsed!.streamId).toBe(99);
      expect(parsed!.payload.length).toBe(0);
    });

    it('round-trips an OPEN frame', () => {
      const frame = buildFrame(MsgType.OPEN, 1, Buffer.from('127.0.0.1:2222'));
      const parsed = parseFrame(frame);
      expect(parsed!.type).toBe(MsgType.OPEN);
      expect(parsed!.payload.toString()).toBe('127.0.0.1:2222');
    });
  });

  describe('MsgType constants', () => {
    it('has correct values matching server-side TunnelBroker', () => {
      expect(MsgType.OPEN).toBe(1);
      expect(MsgType.DATA).toBe(2);
      expect(MsgType.CLOSE).toBe(3);
      expect(MsgType.PING).toBe(4);
      expect(MsgType.PONG).toBe(5);
    });
  });
});
