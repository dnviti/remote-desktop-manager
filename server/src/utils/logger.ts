/* eslint-disable no-console */
import { config } from '../config';

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
} as const;

type LogLevel = keyof typeof LEVELS;

function currentLevel(): number { return LEVELS[config.logLevel] ?? LEVELS.info; }

const SENSITIVE_KEYS = new Set([
  'password', 'temporarypassword', 'newpassword', 'oldpassword',
  'secret', 'clientsecret',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'access_token', 'refresh_token', 'id_token',
  'authorization', 'apikey', 'privatekey',
  'credential', 'credentials',
  'oauth', 'existingoauth',
]);

/**
 * Patterns that indicate sensitive values embedded in strings (e.g. Prisma error messages,
 * stack traces, or interpolated log messages). Each regex is replaced with a redacted label.
 */
const SENSITIVE_VALUE_PATTERNS: Array<[RegExp, string]> = [
  // JWT tokens (eyJ...)
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  // Bearer tokens in headers
  [/Bearer\s+[A-Za-z0-9_.~+/=-]+/gi, 'Bearer [REDACTED]'],
  // Key=value patterns for known sensitive keys (e.g. in Prisma error dumps)
  [/(password|secret|token|apikey|privatekey|authorization|credential|accessToken|refreshToken|clientSecret)\s*[:=]\s*"[^"]*"/gi, '$1: "[REDACTED]"'],
  [/(password|secret|token|apikey|privatekey|authorization|credential|accessToken|refreshToken|clientSecret)\s*[:=]\s*'[^']*'/gi, "$1: '[REDACTED]'"],
];

function scrubSensitiveValues(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (value instanceof Error) {
    const msg = scrubSensitiveValues(value.stack ?? value.message);
    return msg.replace(/[\n\r]/g, '\\n');
  }
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  if (typeof value === 'string') return scrubSensitiveValues(value).replace(/[\n\r]/g, '\\n');
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return result;
  }
  return value;
}

function stripNewlines(s: string): string { return s.replace(/[\n\r]/g, '\\n'); }

function stringify(value: unknown): string {
  if (typeof value === 'string') return stripNewlines(value);
  if (value instanceof Error) return stripNewlines(value.stack ?? value.message);
  try { return stripNewlines(JSON.stringify(value)); } catch { return stripNewlines(String(value)); }
}

function formatArgs(level: LogLevel, prefix: string, args: unknown[]): string {
  const sanitized = args.map(a => sanitize(a));

  if (config.logFormat === 'json') {
    const message = sanitized.map(a => stringify(a)).join(' ');
    const entry: Record<string, unknown> = { level, message };
    if (config.logTimestamps) entry.timestamp = new Date().toISOString();
    if (prefix) entry.module = prefix;
    return JSON.stringify(entry).replace(/[\n\r]/g, '\\n');
  }

  const parts: string[] = [];
  if (config.logTimestamps) parts.push(new Date().toISOString());
  parts.push(`[${level.toUpperCase()}]`);
  if (prefix) parts.push(`[${prefix}]`);
  for (const s of sanitized) parts.push(stringify(s));
  return parts.join(' ').replace(/[\n\r]/g, '\\n');
}

function createLogger(prefix = '') {
  return {
    // All log methods sanitize inputs via formatArgs() which strips newlines and redacts sensitive keys.
    // lgtm[js/log-injection] lgtm[js/clear-text-logging]
    error: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.error) console.error(formatArgs('error', prefix, args)); // lgtm[js/log-injection]
    },
    warn: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.warn) console.warn(formatArgs('warn', prefix, args)); // lgtm[js/log-injection]
    },
    info: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.info) console.log(formatArgs('info', prefix, args)); // lgtm[js/log-injection] lgtm[js/clear-text-logging]
    },
    verbose: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.verbose) console.log(formatArgs('verbose', prefix, args)); // lgtm[js/log-injection]
    },
    debug: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.debug) console.debug(formatArgs('debug', prefix, args)); // lgtm[js/log-injection]
    },
    child: (childPrefix: string) => createLogger(prefix ? `${prefix}:${childPrefix}` : childPrefix),
  };
}

export const logger = createLogger();

export type Logger = ReturnType<typeof createLogger>;

/**
 * Maps LOG_LEVEL to guacamole-lite's numeric log level.
 * guacamole-lite levels: QUIET=0, ERRORS=10, NORMAL=20, VERBOSE=30, DEBUG=40
 *
 * Returns numeric values directly because guacamole-lite's string→number
 * conversion has a bug: LOGLEVEL['QUIET'] is 0 (falsy), so the string
 * 'QUIET' is never converted and log filtering breaks.
 */
export function toGuacamoleLogLevel(level: LogLevel): number {
  switch (level) {
    case 'error': return 10;
    case 'warn':  return 10;
    case 'info':  return 20;
    case 'verbose': return 30;
    case 'debug': return 40;
    default:      return 20;
  }
}
