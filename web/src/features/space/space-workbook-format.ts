import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/presets';
import * as XLSX from 'xlsx';

export const workbookFilePattern = /\.(csv|tsv|xlsx)$/i;
export const maxWorkbookFileBytes = 4 * 1024 * 1024;
const maxRows = 1000;
const maxColumns = 100;
const maxSheets = 12;

function baseWorkbook(title: string): IWorkbookData {
  return { id: 'new-workbook', name: title, appVersion: '1.5.0', locale: 'enUS' as IWorkbookData['locale'], styles: {}, sheetOrder: [], sheets: {} };
}

export function blankWorkbook(title: string, sheetName: string): IWorkbookData {
  const workbook = baseWorkbook(title);
  const id = 'sheet-1';
  workbook.sheetOrder.push(id);
  workbook.sheets[id] = { id, name: sheetName, rowCount: 100, columnCount: 26, cellData: {} };
  return workbook;
}

export function importWorkbook(bytes: ArrayBuffer, name: string): IWorkbookData {
  const format = workbookFilePattern.exec(name)?.[1].toLowerCase();
  if (!format || !bytes.byteLength || bytes.byteLength > maxWorkbookFileBytes) throw new Error('unsupported');
  const isExcel = format === 'xlsx';
  const input = isExcel ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (isExcel && new DataView(bytes).getUint32(0, true) !== 0x04034b50) throw new Error('unsupported');
  const source = XLSX.read(input, {
    type: isExcel ? 'array' : 'string', sheetRows: maxRows + 1, cellFormula: true, cellNF: true, cellStyles: true,
    ...(isExcel ? {} : { raw: true, FS: format === 'tsv' ? '\t' : ',' }),
  });
  if (!source.SheetNames.length || source.SheetNames.length > maxSheets) throw new Error('limits');
  const book = baseWorkbook(name.replace(workbookFilePattern, '').trim().slice(0, 120));
  if (source.Workbook?.WBProps?.date1904) book.dateSystem = 'date1904' as IWorkbookData['dateSystem'];
  if (source.Workbook?.Names?.some(name => !name.Name.startsWith('_xlnm.') && !name.Name.startsWith('_xlfn.'))) throw new Error('linked-formula');
  for (const [index, sheetName] of source.SheetNames.entries()) {
    const sheet = source.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1');
    if (range.e.r >= maxRows || range.e.c >= maxColumns) throw new Error('limits');
    const id = `sheet-${index + 1}`;
    const cellData: IWorksheetData['cellData'] = {};
    for (const address of Object.keys(sheet)) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      if (r >= maxRows || c >= maxColumns) throw new Error('limits');
      const cell = sheet[address] as XLSX.CellObject;
      if (cell.F || cell.D) throw new Error('array-formula');
      if (cell.f?.includes('[')) throw new Error('linked-formula');
      const raw = cell.t === 'e' ? cell.w : cell.v;
      const v = !isExcel && typeof raw === 'string' && raw.length <= 15 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw)
        ? Number(raw) : raw instanceof Date ? cell.w : raw;
      if (v === undefined && !cell.f) continue;
      const entry: ICellData = {
        ...(v === undefined ? {} : { v: typeof v === 'boolean' ? Number(v) : v, t: typeof v === 'boolean' ? 3 : typeof v === 'number' ? 2 : 1 }),
        ...(cell.f ? { f: `=${cell.f}` } : {}),
        ...(typeof cell.z === 'string' && cell.z !== 'General' ? { s: { n: { pattern: cell.z } } } : {}),
      };
      (cellData[r] ??= {})[c] = entry;
    }
    const mergeData = (sheet['!merges'] ?? []).map(({ s, e }) => {
      if (e.r >= maxRows || e.c >= maxColumns) throw new Error('limits');
      range.e.r = Math.max(range.e.r, e.r);
      range.e.c = Math.max(range.e.c, e.c);
      return { startRow: s.r, startColumn: s.c, endRow: e.r, endColumn: e.c };
    });
    const columnData: IWorksheetData['columnData'] = {};
    for (const [column, value] of (sheet['!cols'] ?? []).entries()) {
      if (column >= maxColumns) break;
      if (value?.wpx || value?.hidden) columnData[column] = {
        ...(value.wpx ? { w: value.wpx } : {}), ...(value.hidden ? { hd: 1 } : {}),
      };
    }
    book.sheetOrder.push(id);
    book.sheets[id] = { id, name: sheetName, rowCount: Math.min(maxRows, Math.max(100, range.e.r + 21)),
      columnCount: Math.min(maxColumns, Math.max(26, range.e.c + 6)), cellData, columnData, mergeData,
      hidden: source.Workbook?.Sheets?.[index]?.Hidden ?? 0 };
  }
  return book;
}

export function writeWorkbook(book: IWorkbookData): ArrayBuffer {
  const output = XLSX.utils.book_new();
  output.Workbook = { WBProps: { date1904: book.dateSystem === 'date1904' }, Sheets: [] };
  for (const id of book.sheetOrder) {
    const sheet = book.sheets[id];
    const out: XLSX.WorkSheet = {};
    const end = { r: 0, c: 0 };
    for (const [row, cells] of Object.entries(sheet.cellData ?? {})) {
      for (const [column, cell] of Object.entries<ICellData | null>(cells)) {
        if (!cell || (cell.v == null && !cell.f)) continue;
        const address = { r: Number(row), c: Number(column) };
        const v = cell.t === 3 ? Boolean(cell.v) : cell.v ?? undefined;
        const style = typeof cell.s === 'string' ? book.styles[cell.s] : cell.s;
        out[XLSX.utils.encode_cell(address)] = {
          t: typeof v === 'boolean' ? 'b' : typeof v === 'string' ? 's' : 'n', v,
          ...(cell.f ? { f: cell.f.replace(/^=/, '') } : {}), ...(style?.n?.pattern ? { z: style.n.pattern } : {}),
        } satisfies XLSX.CellObject;
        end.r = Math.max(end.r, address.r);
        end.c = Math.max(end.c, address.c);
      }
    }
    out['!merges'] = sheet.mergeData?.map(({ startRow, startColumn, endRow, endColumn }) => {
      end.r = Math.max(end.r, endRow);
      end.c = Math.max(end.c, endColumn);
      return { s: { r: startRow, c: startColumn }, e: { r: endRow, c: endColumn } };
    });
    const cols: XLSX.ColInfo[] = [];
    for (const [index, column] of Object.entries(sheet.columnData ?? {})) {
      if (column?.w || column?.hd) cols[Number(index)] = { wpx: column.w, hidden: column.hd === 1 };
    }
    out['!cols'] = cols;
    out['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: end });
    XLSX.utils.book_append_sheet(output, out, sheet.name ?? id, true);
    output.Workbook.Sheets!.push({ Hidden: sheet.hidden ?? 0 });
  }
  return XLSX.write(output, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
}
