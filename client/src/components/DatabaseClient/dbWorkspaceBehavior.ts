import type { DbSessionConfig } from '../../api/database.api';

export type WorkspaceQueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'EXEC' | 'OTHER';

export function stripLeadingComments(sql: string): string {
  let remaining = sql.trim();
  for (;;) {
    if (remaining.startsWith('--')) {
      const newline = remaining.indexOf('\n');
      remaining = (newline === -1 ? '' : remaining.slice(newline + 1)).trimStart();
    } else if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/');
      remaining = (end === -1 ? '' : remaining.slice(end + 2)).trimStart();
    } else {
      break;
    }
  }
  return remaining;
}

export function classifyQueryType(sql: string): WorkspaceQueryType {
  const text = stripLeadingComments(sql);
  if (/^SELECT\b/i.test(text)) return 'SELECT';
  if (/^INSERT\b/i.test(text)) return 'INSERT';
  if (/^UPDATE\b/i.test(text)) return 'UPDATE';
  if (/^DELETE\b/i.test(text)) return 'DELETE';
  if (/^(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(text)) return 'DDL';
  if (/^WITH\b/i.test(text)) {
    if (/\)\s*INSERT\b/i.test(text)) return 'INSERT';
    if (/\)\s*UPDATE\b/i.test(text)) return 'UPDATE';
    if (/\)\s*DELETE\b/i.test(text)) return 'DELETE';
    return 'SELECT';
  }
  if (/^(EXPLAIN|DESCRIBE|DESC|SHOW)\b/i.test(text)) return 'SELECT';
  if (/^(GRANT|REVOKE|SET)\b/i.test(text)) return 'DDL';
  if (/^MERGE\b/i.test(text)) return 'UPDATE';
  if (/^(CALL|EXEC|EXECUTE)\b/i.test(text)) return 'EXEC';
  return 'OTHER';
}

export function defaultSessionConfigForProtocol(protocol: string, databaseName?: string): DbSessionConfig {
  const normalized = protocol.toLowerCase();
  const defaults: DbSessionConfig = {};

  switch (normalized) {
    case 'postgresql':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (databaseName) {
        defaults.activeDatabase = databaseName;
        defaults.searchPath = 'public';
      }
      return defaults;
    case 'mysql':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (databaseName) {
        defaults.activeDatabase = databaseName;
      }
      return defaults;
    case 'mssql':
      if (databaseName) {
        defaults.activeDatabase = databaseName;
      }
      return defaults;
    case 'oracle':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return defaults;
    default:
      return defaults;
  }
}
