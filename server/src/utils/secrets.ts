import { readFileSync } from 'fs';
import { join } from 'path';

const SECRETS_DIR = process.env.SECRETS_DIR || '/run/secrets';
const cache = new Map<string, string>();

/**
 * Read a secret from Podman secret file, falling back to env var.
 * Results are cached to avoid repeated filesystem access.
 */
export function readSecret(secretName: string, envFallback?: string): string | undefined {
  if (cache.has(secretName)) return cache.get(secretName);

  // Try Podman secret file first
  try {
    const value = readFileSync(join(SECRETS_DIR, secretName), 'utf-8').trim();
    if (value) {
      cache.set(secretName, value);
      return value;
    }
  } catch {
    // File doesn't exist — fall through to env var
  }

  // Fall back to environment variable
  const envValue = envFallback ? process.env[envFallback] : undefined;
  if (envValue) cache.set(secretName, envValue);
  return envValue;
}

/**
 * Read a required secret. Throws with actionable error if missing.
 */
export function readRequiredSecret(secretName: string, envFallback: string, description: string): string {
  const value = readSecret(secretName, envFallback);
  if (!value) {
    throw new Error(
      `${description} not found. Either create Podman secret "${secretName}" ` +
      `(podman secret create ${secretName} - <<< "value") ` +
      `or set the ${envFallback} environment variable.`,
    );
  }
  return value;
}
