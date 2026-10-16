// Send a table as a download: CSV (UTF-8 with BOM, formulas defused) or Excel.
import type { Response } from 'express';
import writeXlsxFile from 'write-excel-file/node';

export type Cell = string | number | null | undefined;

export function csvCell(v: Cell): string {
  const s = String(v ?? '');
  // quote, and defuse spreadsheet formulas
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const toCsv = (header: string[], rows: Cell[][]) => String.fromCharCode(0xfeff) + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

export async function sendTable(res: Response, name: string, header: string[], rows: Cell[][], format: unknown) {
  const file = name.replace(/[^A-Za-z0-9_-]+/g, '-');
  if (format !== 'xlsx') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"` });
    return void res.send(toCsv(header, rows));
  }
  const data = [
    header.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) => r.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: String(v ?? ''), type: String }))),
  ];
  const buf = await writeXlsxFile(data as never, { buffer: true } as never);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${file}.xlsx"` });
  res.send(buf);
}
