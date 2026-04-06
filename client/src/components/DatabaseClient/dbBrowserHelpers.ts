export type DbProtocolHint = 'postgresql' | 'mysql' | 'mongodb' | 'oracle' | 'mssql' | 'db2' | string;

export interface SchemaBrowserTerms {
  title: string;
  groupLabel: string;
  tableSectionLabel: string;
  tableObjectLabel: string;
  columnObjectLabel: string;
  emptyMessage: string;
}

export function normalizeDbProtocol(protocol?: DbProtocolHint): string {
  return String(protocol ?? 'postgresql').trim().toLowerCase();
}

export function getSchemaBrowserTerms(protocol?: DbProtocolHint): SchemaBrowserTerms {
  switch (normalizeDbProtocol(protocol)) {
    case 'mongodb':
      return {
        title: 'Collections',
        groupLabel: 'Database',
        tableSectionLabel: 'Collections',
        tableObjectLabel: 'collection',
        columnObjectLabel: 'field',
        emptyMessage: 'No collections found. Connect to a MongoDB database to browse its collections.',
      };
    case 'mysql':
      return {
        title: 'Database',
        groupLabel: 'Database',
        tableSectionLabel: 'Tables',
        tableObjectLabel: 'table',
        columnObjectLabel: 'column',
        emptyMessage: 'No objects found. Connect to a MySQL database to browse its objects.',
      };
    case 'oracle':
      return {
        title: 'Objects',
        groupLabel: 'Owner',
        tableSectionLabel: 'Tables',
        tableObjectLabel: 'table',
        columnObjectLabel: 'column',
        emptyMessage: 'No objects found. Connect to an Oracle schema to browse its objects.',
      };
    default:
      return {
        title: 'Schema',
        groupLabel: 'Schema',
        tableSectionLabel: 'Tables',
        tableObjectLabel: 'table',
        columnObjectLabel: 'column',
        emptyMessage: 'No objects found. Connect to a database to browse its schema.',
      };
  }
}

export function qualifyDbObjectName(protocol: DbProtocolHint | undefined, schema: string, name: string): string {
  const normalized = normalizeDbProtocol(protocol);
  const trimmedSchema = schema.trim();
  const trimmedName = name.trim();
  if (!trimmedSchema) {
    return trimmedName;
  }
  if ((normalized === 'postgresql' && trimmedSchema === 'public') || (normalized === 'mssql' && trimmedSchema === 'dbo')) {
    return trimmedName;
  }
  return `${trimmedSchema}.${trimmedName}`;
}

export function buildLimitedSelectSql(
  protocol: DbProtocolHint | undefined,
  selection: string,
  from: string,
  limit = 100,
): string {
  const normalized = normalizeDbProtocol(protocol);
  const lines: string[] = [];

  switch (normalized) {
    case 'mssql':
      lines.push(`SELECT TOP ${limit} ${selection}`);
      lines.push(`FROM ${from}`);
      break;
    case 'oracle':
      lines.push(`SELECT ${selection}`);
      lines.push(`FROM ${from}`);
      lines.push(`FETCH FIRST ${limit} ROWS ONLY`);
      break;
    default:
      lines.push(`SELECT ${selection}`);
      lines.push(`FROM ${from}`);
      lines.push(`LIMIT ${limit}`);
      break;
  }

  return `${lines.join('\n')};`;
}

export function buildMongoQuerySpec(spec: Record<string, unknown>): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export function buildMongoCollectionQuery(
  collectionName: string,
  databaseName?: string,
  overrides: Record<string, unknown> = {},
): string {
  const payload: Record<string, unknown> = {
    operation: 'find',
    collection: collectionName,
    filter: {},
    limit: 100,
    ...overrides,
  };
  if (databaseName) {
    payload.database = databaseName;
  }
  return buildMongoQuerySpec(payload);
}
