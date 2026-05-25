import type { WorkSheet } from 'xlsx';

/** SheetJS utils assume `!ref` exists; some workbooks list sheet names without a matching `Sheets` entry or range. */
export function isRenderableWorksheet(ws: WorkSheet | undefined): ws is WorkSheet {
  return Boolean(ws && typeof ws['!ref'] === 'string' && ws['!ref'].length > 0);
}

export function safeSheetToCsv(
  XLSX: typeof import('xlsx'),
  worksheet: WorkSheet | undefined,
  sheetName: string,
): string {
  if (!worksheet) {
    return `(Sheet "${sheetName}" is missing from the workbook.)`;
  }
  if (!isRenderableWorksheet(worksheet)) {
    return '';
  }
  try {
    return XLSX.utils.sheet_to_csv(worksheet);
  } catch {
    return `(Could not read sheet "${sheetName}".)`;
  }
}
