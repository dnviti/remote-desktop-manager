import crypto from 'crypto';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child('pwnedPassword');

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range';
const HIBP_USER_AGENT = 'Arsenale-PasswordCheck';

/**
 * Check if a password has been exposed in known data breaches
 * using the HaveIBeenPwned k-Anonymity API.
 *
 * Only the first 5 characters of the SHA-1 hash are sent to the API.
 * The full hash never leaves the server.
 *
 * @returns The number of times the password has been seen in breaches (0 = not found).
 */
/**
 * Compute the SHA-1 fingerprint of a string for the HIBP k-Anonymity lookup.
 * This is NOT used for password storage — HIBP requires SHA-1 prefix matching.
 */
function hibpFingerprint(input: string): string {
  // lgtm[js/insufficient-password-hash] — SHA-1 mandated by HIBP k-Anonymity API; not used for storage
  return crypto.createHash('sha1').update(input).digest('hex').toUpperCase();
}

export async function checkPwnedPassword(password: string): Promise<number> {
  try {
    const sha1 = hibpFingerprint(password);
    const prefix = sha1.substring(0, 5);
    const suffix = sha1.substring(5);

    const response = await fetch(`${HIBP_API_URL}/${prefix}`, {
      headers: {
        'User-Agent': HIBP_USER_AGENT,
        'Add-Padding': 'true',
      },
    });

    if (!response.ok) {
      if (config.hibpFailOpen) {
        log.warn(`HIBP API returned status ${response.status}, proceeding (HIBP_FAIL_OPEN=true)`);
        return 0;
      }
      throw new AppError('Password strength could not be verified. Please try again later.', 503);
    }

    const text = await response.text();
    const lines = text.split('\n');

    for (const line of lines) {
      const [hashSuffix, countStr] = line.trim().split(':');
      if (hashSuffix === suffix) {
        const count = parseInt(countStr, 10);
        return isNaN(count) ? 0 : count;
      }
    }

    return 0;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (config.hibpFailOpen) {
      log.warn('Failed to check HIBP API, proceeding (HIBP_FAIL_OPEN=true)');
      return 0;
    }
    throw new AppError('Password strength could not be verified. Please try again later.', 503);
  }
}

/**
 * Extract the password from a secret payload if it has one.
 * Returns null for secret types that don't contain passwords.
 */
export function extractPasswordFromPayload(
  data: { type: string; password?: string; passphrase?: string }
): string | null {
  switch (data.type) {
    case 'LOGIN':
      return data.password || null;
    case 'SSH_KEY':
      return data.passphrase || null;
    case 'CERTIFICATE':
      return data.passphrase || null;
    default:
      return null;
  }
}
