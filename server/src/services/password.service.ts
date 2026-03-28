import crypto from 'crypto';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child('password');

const HIBP_API_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 5000;
const HIBP_USER_AGENT = 'Arsenale-PasswordCheck';

export async function checkPasswordBreach(password: string): Promise<{ breached: boolean; count: number }> {
  // SHA-1 is mandated by the HIBP k-Anonymity API — only the first 5 hex chars are sent.
  // Password storage uses bcrypt. lgtm[js/insufficient-password-hash]
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);

  const response = await fetch(`${HIBP_API_URL}${prefix}`, {
    headers: { 'User-Agent': HIBP_USER_AGENT },
    signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HIBP API returned status ${response.status}`);
  }

  const body = await response.text();
  for (const line of body.split('\r\n')) {
    const [hashSuffix, countStr] = line.split(':');
    if (hashSuffix === suffix) {
      return { breached: true, count: parseInt(countStr, 10) };
    }
  }

  return { breached: false, count: 0 };
}

export async function assertPasswordNotBreached(password: string): Promise<void> {
  try {
    const result = await checkPasswordBreach(password);
    if (result.breached) {
      throw new AppError(
        'This password has appeared in a known data breach. Please choose a different password.',
        400,
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (config.hibpFailOpen) {
      log.warn('HIBP breach check unavailable, proceeding without check (HIBP_FAIL_OPEN=true)');
    } else {
      throw new AppError('Password strength could not be verified. Please try again later.', 503);
    }
  }
}
