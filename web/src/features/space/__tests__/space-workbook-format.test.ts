import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { importWorkbook, writeWorkbook } from '../space-workbook-format';

describe('Space workbook exchange', () => {
  it('round trips cross-sheet formulas, booleans, and number formats', () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { A1: { t: 'n', v: 42.55, z: '0.00' }, B1: { t: 'b', v: false }, '!ref': 'A1:B1' }, 'Inputs');
    XLSX.utils.book_append_sheet(book, { A1: { t: 'n', v: 42.55, f: 'Inputs!A1' }, '!ref': 'A1' }, 'Summary');
    const snapshot = importWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'report.xlsx');
    expect(snapshot.sheets['sheet-2'].cellData?.[0][0]?.f).toBe('=Inputs!A1');
    const exported = XLSX.read(writeWorkbook(snapshot), { cellNF: true });
    expect(exported.SheetNames).toEqual(['Inputs', 'Summary']);
    expect(exported.Sheets.Inputs.A1).toMatchObject({ v: 42.55, z: '0.00' });
    expect(exported.Sheets.Inputs.B1).toMatchObject({ v: false, t: 'b' });
    expect(exported.Sheets.Summary.A1).toMatchObject({ f: 'Inputs!A1', v: 42.55 });
  });

  it('keeps CSV identifiers as text and parses ordinary amounts', () => {
    const csv = new TextEncoder().encode('code,amount\r\n00123,12.5\r\n"=sum(A1)",1');
    const snapshot = importWorkbook(csv.buffer, 'budget.csv');
    const cells = snapshot.sheets['sheet-1'].cellData;
    expect(cells?.[1][0]).toMatchObject({ v: '00123' });
    expect(cells?.[1][1]).toMatchObject({ v: 12.5 });
    expect(cells?.[2][0]).toEqual({ v: '=sum(A1)', t: 1 });
  });
});
