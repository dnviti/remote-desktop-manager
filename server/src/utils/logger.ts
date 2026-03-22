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

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (value instanceof Error) return (value.stack ?? value.message).replace(/[\n\r]/g, '\\n');
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  if (typeof value === 'string') return value.replace(/[\n\r]/g, '\\n');
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return result;
  }
  return value;
}

function formatArgs(level: LogLevel, prefix: string, args: unknown[]): unknown[] {
  const sanitized = args.map(a => sanitize(a));

  if (config.logFormat === 'json') {
    const message = sanitized.map(a =>
      typeof a === 'string' ? a : JSON.stringify(a),
    ).join(' ');
    const entry: Record<string, unknown> = { level, message };
    if (config.logTimestamps) entry.timestamp = new Date().toISOString();
    if (prefix) entry.module = prefix;
    return [JSON.stringify(entry)];
  }

  const parts: unknown[] = [];
  if (config.logTimestamps) parts.push(new Date().toISOString());
  parts.push(`[${level.toUpperCase()}]`);
  if (prefix) parts.push(`[${prefix}]`);
  parts.push(...sanitized);
  return parts;
}

function createLogger(prefix = '') {
  return {
    error: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.error) console.error(...formatArgs('error', prefix, args));
    },
    warn: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.warn) console.warn(...formatArgs('warn', prefix, args));
    },
    info: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.info) console.log(...formatArgs('info', prefix, args));
    },
    verbose: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.verbose) console.log(...formatArgs('verbose', prefix, args));
    },
    debug: (...args: unknown[]) => {
      if (currentLevel() >= LEVELS.debug) console.debug(...formatArgs('debug', prefix, args));
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
