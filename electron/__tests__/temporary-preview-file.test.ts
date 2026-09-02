import { mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupStaleTemporaryPreviews,
  stageTemporarySpreadsheet,
  TEMPORARY_PREVIEW_TTL_MS,
  TEMPORARY_SPREADSHEET_MAX_BYTES,
  validateTemporarySpreadsheetInput,
} from '../ipc/temporary-preview-file.js';

const testRoots: string[] = [];

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'xopc-preview-test-'));
  testRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('temporary spreadsheet previews', () => {
  it('accepts safe Excel files and rejects unsafe names, formats, and oversized data', () => {
    expect(validateTemporarySpreadsheetInput({
      fileName: '销售汇总.xlsx',
      data: new Uint8Array([1, 2, 3]),
    })).toMatchObject({ ok: true });

    for (const fileName of ['../secret.xlsx', '..\\secret.xlsx', '/tmp/secret.xlsx', 'macro.xlsm']) {
      expect(validateTemporarySpreadsheetInput({
        fileName,
        data: new Uint8Array([1]),
      })).toMatchObject({ ok: false, code: 'INVALID_FILE' });
    }

    expect(validateTemporarySpreadsheetInput({
      fileName: 'large.xlsx',
      data: new Uint8Array(TEMPORARY_SPREADSHEET_MAX_BYTES + 1),
    })).toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });

  it('stages a byte-identical file under an isolated directory', async () => {
    const root = await createTestRoot();
    const staged = await stageTemporarySpreadsheet(root, {
      fileName: '季度 报表.xlsx',
      data: new Uint8Array([80, 75, 3, 4]),
    });

    expect(staged.filePath).toBe(join(staged.directory, '季度 报表.xlsx'));
    expect(staged.directory.startsWith(root)).toBe(true);
    expect([...await readFile(staged.filePath)]).toEqual([80, 75, 3, 4]);
  });

  it('removes expired preview directories while retaining recent ones', async () => {
    const root = await createTestRoot();
    const oldPreview = await stageTemporarySpreadsheet(root, {
      fileName: 'old.xlsx',
      data: new Uint8Array([1]),
    });
    const recentPreview = await stageTemporarySpreadsheet(root, {
      fileName: 'recent.xlsx',
      data: new Uint8Array([2]),
    });
    const now = Date.now();
    const oldTime = new Date(now - TEMPORARY_PREVIEW_TTL_MS - 1_000);
    await utimes(oldPreview.directory, oldTime, oldTime);

    await cleanupStaleTemporaryPreviews(root, now);

    await expect(stat(oldPreview.directory)).rejects.toThrow();
    await expect(stat(recentPreview.filePath)).resolves.toBeDefined();
  });
});
