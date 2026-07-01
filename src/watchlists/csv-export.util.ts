/**
 * RFC 4180-style CSV cells for watchlist export (UTF-8 with BOM for Excel compatibility).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Each inner array is one row (row 0 is often the header). */
export function buildWatchlistCsv(rows: string[][]): string {
  const lines = rows.map((r) => r.map(escapeCsvCell).join(','));
  return `\ufeff${lines.join('\r\n')}\r\n`;
}
