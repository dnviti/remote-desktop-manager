import jwt from 'jsonwebtoken';
import { config } from '../config';

// Lazy import to avoid circular dependency at module load time
let getSecretValueSync: ((name: string) => { current: string; previous: string | null }) | null = null;

function getJwtSecrets(): { current: string; previous: string | null } {
  if (!getSecretValueSync) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const svc = require('../services/systemSecrets.service');
      getSecretValueSync = svc.getSecretValueSync;
    } catch {
      // Service not loaded yet (during startup) — use config directly
    }
  }

  if (getSecretValueSync) {
    try {
      return getSecretValueSync('jwt_secret');
    } catch {
      // Cache not populated yet
    }
  }

  return { current: config.jwtSecret, previous: null };
}

/**
 * Verify a JWT token with explicit algorithm pinning to HS256.
 *
 * SECURITY: Always use this wrapper instead of calling jwt.verify() directly.
 * Pinning the algorithm prevents algorithm confusion attacks where an attacker
 * crafts a token with a different algorithm (e.g., switching from HMAC to RSA).
 *
 * After secret rotation, tokens signed with the previous secret are still valid
 * during the grace period (until the next rotation replaces the previous version).
 *
 * @see https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
 */
export function verifyJwt<T = Record<string, unknown>>(token: string): T {
  const { current, previous } = getJwtSecrets();

  // Try current secret first
  try {
    return jwt.verify(token, current, { algorithms: ['HS256'] }) as T;
  } catch (currentErr) {
    // If previous version exists, try it (grace period after rotation)
    if (previous) {
      try {
        return jwt.verify(token, previous, { algorithms: ['HS256'] }) as T;
      } catch {
        // Both failed — throw the original error
      }
    }
    throw currentErr;
  }
}
