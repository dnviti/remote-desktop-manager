 

type Column = { key: string; header: string; width?: number };

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: Column[],
): void {
  if (rows.length === 0) {
    console.log('(no results)');
    return;
  }

  // Auto-calculate widths if not provided
  const cols = columns.map((col) => {
    const maxData = rows.reduce(
      (max, row) => Math.max(max, String(row[col.key] ?? '').length),
      0,
    );
    return { ...col, width: col.width ?? Math.max(col.header.length, maxData) };
  });

  // Header
  const headerLine = cols.map((c) => c.header.padEnd(c.width as number)).join('  ');
  console.log(headerLine);
  console.log(cols.map((c) => '-'.repeat(c.width as number)).join('  '));

  // Rows
  for (const row of rows) {
    const line = cols
      .map((c) => String(row[c.key] ?? '').padEnd(c.width as number))
      .join('  ');
    console.log(line);
  }
}

export function printSummary(label: string, count: number): void {
  console.log(`${label}: ${count}`);
}

export function printError(message: string): void {
  console.error(`Error: ${message}`);
}

export function printSuccess(message: string): void {
  console.log(message);
}
