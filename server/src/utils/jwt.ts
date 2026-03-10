import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Verify a JWT token with explicit algorithm pinning to HS256.
 *
 * SECURITY: Always use this wrapper instead of calling jwt.verify() directly.
 * Pinning the algorithm prevents algorithm confusion attacks where an attacker
 * crafts a token with a different algorithm (e.g., switching from HMAC to RSA).
 *
 * @see https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
 */
export function verifyJwt<T = Record<string, unknown>>(token: string): T {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
  }) as T;
}
