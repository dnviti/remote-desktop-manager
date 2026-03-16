/**
 * Token encryption utilities using the Web Crypto API (AES-GCM 256-bit).
 *
 * Defense-in-depth: encrypts JWT tokens before they are persisted to
 * chrome.storage.local. The encryption key is stored in chrome.storage.session
 * which is ephemeral (cleared on browser restart / service worker termination
 * in MV3). When the session key is unavailable, a new one is generated and
 * existing plaintext tokens are encrypted on first access (migration).
 *
 * Encrypted format: base64(iv:ciphertext) where iv is 12 bytes (AES-GCM nonce).
 */

const SESSION_KEY_NAME = 'tokenEncryptionKey';

// ── Helpers ────────────────────────────────────────────────────────────

/** Convert an ArrayBuffer to a base64 string. */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert a base64 string to a Uint8Array. */
function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Key management ─────────────────────────────────────────────────────

/** Generate a fresh AES-GCM 256-bit key via Web Crypto. */
async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable so we can export/import to storage
    ['encrypt', 'decrypt'],
  );
}

/** Export a CryptoKey as a JWK for storage in chrome.storage.session. */
async function exportKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/** Import a JWK back into a CryptoKey. */
async function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Retrieve the encryption key from chrome.storage.session, or generate
 * a new one if none exists. The key is ephemeral — cleared when the
 * browser restarts or the service worker is terminated.
 */
export async function getOrCreateKey(): Promise<CryptoKey> {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY_NAME);
    const stored = result[SESSION_KEY_NAME] as JsonWebKey | undefined;
    if (stored) {
      return await importKey(stored);
    }
  } catch {
    // session storage may not be available or key missing — generate fresh
  }

  const key = await generateKey();
  const jwk = await exportKey(key);
  await chrome.storage.session.set({ [SESSION_KEY_NAME]: jwk });
  return key;
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-GCM.
 * Returns a string in the format `base64(iv).base64(ciphertext)`.
 */
export async function encryptToken(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  return `${bufferToBase64(iv.buffer)}.${bufferToBase64(ciphertext)}`;
}

/**
 * Decrypt an encrypted token string produced by `encryptToken`.
 * Returns the original plaintext.
 */
export async function decryptToken(encrypted: string, key: CryptoKey): Promise<string> {
  const [ivB64, ciphertextB64] = encrypted.split('.');
  if (!ivB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = base64ToBuffer(ivB64);
  const ciphertext = base64ToBuffer(ciphertextB64);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
    key,
    ciphertext as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plaintext);
}

// ── Detection ──────────────────────────────────────────────────────────

/**
 * Heuristic to detect whether a token value is already encrypted.
 *
 * Encrypted tokens follow the format `base64.base64` (two base64 segments
 * separated by a dot). JWTs have exactly three dot-separated segments
 * (`header.payload.signature`). A raw refresh token from the server is
 * typically a UUID or opaque string without dots, or a JWT.
 *
 * Rules:
 * - If the string contains exactly one dot and both halves are valid
 *   base64, it is treated as encrypted.
 * - Everything else (0 dots, 2+ dots i.e. JWT, non-base64) is plaintext.
 */
export function isEncryptedToken(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 2) return false;

  // Quick check: both parts must be non-empty base64
  const b64re = /^[A-Za-z0-9+/]+=*$/;
  return b64re.test(parts[0]) && b64re.test(parts[1]);
}
