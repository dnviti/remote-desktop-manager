export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  savedAt: string;
}

const STORAGE_KEY_PREFIX = 'arsenale-saved-queries-';

function getSavedQueriesKey(connectionId: string): string {
  return `${STORAGE_KEY_PREFIX}${connectionId}`;
}

function createSavedQueryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sq-${crypto.randomUUID()}`;
  }
  return `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadSavedQueries(connectionId: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(getSavedQueriesKey(connectionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSavedQueries(connectionId: string, queries: SavedQuery[]): void {
  localStorage.setItem(getSavedQueriesKey(connectionId), JSON.stringify(queries));
}

export function addSavedQuery(connectionId: string, name: string, sql: string): SavedQuery {
  const queries = loadSavedQueries(connectionId);
  const entry: SavedQuery = {
    id: createSavedQueryId(),
    name,
    sql,
    savedAt: new Date().toISOString(),
  };
  queries.unshift(entry);
  saveSavedQueries(connectionId, queries);
  return entry;
}

export function deleteSavedQuery(connectionId: string, id: string): void {
  const queries = loadSavedQueries(connectionId).filter((q) => q.id !== id);
  saveSavedQueries(connectionId, queries);
}

/**
 * Derive a short human-readable label from raw SQL.
 * Extracts CTE names, target tables, and join partners.
 */
export function deriveQueryLabel(sql: string): string {
  const trimmed = sql.trim();

  const cteMatch = trimmed.match(/^WITH\s+(\w+)/i);
  if (cteMatch) {
    const cteNames: string[] = [];
    const cteRegex = /\b(\w+)\s+AS\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = cteRegex.exec(trimmed)) !== null) {
      const name = match[1].toLowerCase();
      if (name !== 'with' && name !== 'select' && name !== 'not') {
        cteNames.push(match[1]);
      }
      if (cteNames.length >= 2) {
        break;
      }
    }
    if (cteNames.length > 0) {
      return cteNames.length === 1
        ? `CTE: ${cteNames[0]}`
        : `CTE: ${cteNames[0]}, ${cteNames[1]}...`;
    }
  }

  const insertMatch = trimmed.match(/^INSERT\s+INTO\s+(?:["`])?(\w+)/i);
  if (insertMatch) {
    return `INSERT ${insertMatch[1]}`;
  }

  const updateMatch = trimmed.match(/^UPDATE\s+(?:["`])?(\w+)/i);
  if (updateMatch) {
    return `UPDATE ${updateMatch[1]}`;
  }

  const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(?:["`])?(\w+)/i);
  if (deleteMatch) {
    return `DELETE ${deleteMatch[1]}`;
  }

  const ddlHead = trimmed.match(/^(CREATE|ALTER|DROP)\s+(\w+)\s+/i);
  if (ddlHead) {
    const rest = trimmed
      .slice(ddlHead[0].length)
      .replace(/^IF\s+NOT\s+EXISTS\s+/i, '')
      .replace(/^IF\s+EXISTS\s+/i, '');
    const objMatch = rest.match(/^(?:["`])?(\w+)/);
    if (objMatch) {
      return `${ddlHead[1].toUpperCase()} ${ddlHead[2].toUpperCase()} ${objMatch[1]}`;
    }
  }

  const tables: string[] = [];
  const fromMatch = trimmed.match(/\bFROM\s+(?:["`])?(\w+)/i);
  if (fromMatch) {
    tables.push(fromMatch[1]);
  }

  const joinRegex = /\bJOIN\s+(?:["`])?(\w+)/gi;
  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = joinRegex.exec(trimmed)) !== null) {
    if (!tables.includes(joinMatch[1])) {
      tables.push(joinMatch[1]);
    }
    if (tables.length >= 3) {
      break;
    }
  }

  if (tables.length > 0) {
    const label = tables.slice(0, 2).join(' + ');
    return tables.length > 2 ? `${label} +${tables.length - 2}` : label;
  }

  const firstLine = trimmed.split('\n')[0].trim();
  return firstLine.length > 40 ? `${firstLine.slice(0, 37)}...` : firstLine;
}
