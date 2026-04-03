import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageArea, installChromeMock } from '../test/chrome';
import {
  decryptToken,
  encryptToken,
  getOrCreateKey,
  isEncryptedToken,
} from './tokenEncryption';

describe('tokenEncryption', () => {
  let session: ReturnType<typeof createStorageArea>;

  beforeEach(() => {
    ({ session } = installChromeMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates a session key once and reuses it on subsequent calls', async () => {
    const firstKey = await getOrCreateKey();
    const encrypted = await encryptToken('refresh-token', firstKey);
    const secondKey = await getOrCreateKey();

    expect(session.set).toHaveBeenCalledTimes(1);
    await expect(decryptToken(encrypted, secondKey)).resolves.toBe('refresh-token');
  });

  it('round-trips encrypted tokens', async () => {
    const key = await getOrCreateKey();
    const encrypted = await encryptToken('access-token', key);

    expect(encrypted).toContain('.');
    await expect(decryptToken(encrypted, key)).resolves.toBe('access-token');
  });

  it('rejects malformed encrypted payloads', async () => {
    const key = await getOrCreateKey();

    await expect(decryptToken('not-valid', key)).rejects.toThrow('Invalid encrypted token format');
  });

  it('distinguishes encrypted tokens from raw tokens and jwt values', async () => {
    const key = await getOrCreateKey();
    const encrypted = await encryptToken('opaque-refresh-token', key);

    expect(isEncryptedToken(encrypted)).toBe(true);
    expect(isEncryptedToken('header.payload.signature')).toBe(false);
    expect(isEncryptedToken('opaque-refresh-token')).toBe(false);
  });
});
