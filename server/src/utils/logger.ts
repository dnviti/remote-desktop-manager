import { config } from '../config';

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
} as const;

type LogLevel = keyof typeof LEVELS;

const currentLevel: number = LEVELS[config.logLevel] ?? LEVELS.info;

function formatArgs(level: LogLevel, prefix: string, args: unknown[]): unknown[] {
  if (config.logFormat === 'json') {
    const message = args.map(a =>
      typeof a === 'string' ? a : (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a)),
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
  parts.push(...args);
  return parts;
}

function createLogger(prefix = '') {
  return {
    error: (...args: unknown[]) => {
      if (currentLevel >= LEVELS.error) console.error(...formatArgs('error', prefix, args));
    },
    warn: (...args: unknown[]) => {
      if (currentLevel >= LEVELS.warn) console.warn(...formatArgs('warn', prefix, args));
    },
    info: (...args: unknown[]) => {
      if (currentLevel >= LEVELS.info) console.log(...formatArgs('info', prefix, args));
    },
    verbose: (...args: unknown[]) => {
      if (currentLevel >= LEVELS.verbose) console.log(...formatArgs('verbose', prefix, args));
    },
    debug: (...args: unknown[]) => {
      if (currentLevel >= LEVELS.debug) console.debug(...formatArgs('debug', prefix, args));
    },
    child: (childPrefix: string) => createLogger(prefix ? `${prefix}:${childPrefix}` : childPrefix),
  };
}

export const logger = createLogger();

export type Logger = ReturnType<typeof createLogger>;

/**
 * Maps LOG_LEVEL to guacamole-lite's log level string.
 * guacamole-lite levels: QUIET, ERRORS, NORMAL, VERBOSE, DEBUG
 */
export function toGuacamoleLogLevel(level: LogLevel): string {
  switch (level) {
    case 'error': return 'ERRORS';
    case 'warn':  return 'ERRORS';
    case 'info':  return 'NORMAL';
    case 'verbose': return 'VERBOSE';
    case 'debug': return 'DEBUG';
    default:      return 'NORMAL';
  }
}
