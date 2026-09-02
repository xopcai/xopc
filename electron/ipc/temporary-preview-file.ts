import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

export const TEMPORARY_SPREADSHEET_MAX_BYTES = 32 * 1024 * 1024;
export const TEMPORARY_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

const TEMPORARY_SPREADSHEET_EXTENSIONS = new Set(['.xls', '.xlsx']);

export type TemporarySpreadsheetInput = {
  fileName: string;
  data: Uint8Array;
};

export type TemporarySpreadsheetValidation =
  | { ok: true; input: TemporarySpreadsheetInput }
  | { ok: false; code: 'INVALID_FILE' | 'TOO_LARGE'; error: string };

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function validateTemporarySpreadsheetInput(input: unknown): TemporarySpreadsheetValidation {
  if (!input || typeof input !== 'object') {
    return { ok: false, code: 'INVALID_FILE', error: 'Invalid temporary file request.' };
  }
  const candidate = input as { fileName?: unknown; data?: unknown };
  if (
    typeof candidate.fileName !== 'string'
    || !candidate.fileName.trim()
    || candidate.fileName.includes('\0')
    || candidate.fileName.includes('/')
    || candidate.fileName.includes('\\')
    || basename(candidate.fileName) !== candidate.fileName
  ) {
    return { ok: false, code: 'INVALID_FILE', error: 'Invalid spreadsheet file name.' };
  }
  if (!TEMPORARY_SPREADSHEET_EXTENSIONS.has(extname(candidate.fileName).toLowerCase())) {
    return { ok: false, code: 'INVALID_FILE', error: 'Only .xls and .xlsx files can be opened.' };
  }
  const data = toUint8Array(candidate.data);
  if (!data || data.byteLength === 0) {
    return { ok: false, code: 'INVALID_FILE', error: 'Spreadsheet data is missing.' };
  }
  if (data.byteLength > TEMPORARY_SPREADSHEET_MAX_BYTES) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      error: `Spreadsheet exceeds ${TEMPORARY_SPREADSHEET_MAX_BYTES} bytes.`,
    };
  }
  return { ok: true, input: { fileName: candidate.fileName, data } };
}

export async function stageTemporarySpreadsheet(
  root: string,
  input: TemporarySpreadsheetInput,
): Promise<{ directory: string; filePath: string }> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'spreadsheet-'));
  const filePath = join(directory, input.fileName);
  try {
    await writeFile(filePath, input.data, { mode: 0o600 });
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupStaleTemporaryPreviews(
  root: string,
  now = Date.now(),
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const entryPath = join(root, entry.name);
    try {
      const metadata = await lstat(entryPath);
      if (now - metadata.mtimeMs < TEMPORARY_PREVIEW_TTL_MS) return;
      await rm(entryPath, { recursive: metadata.isDirectory(), force: true });
    } catch {
      /* stale preview cleanup is best-effort */
    }
  }));
}
