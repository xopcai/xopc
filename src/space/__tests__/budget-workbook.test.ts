import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SPACE_WORKBOOK_MIME } from '@xopcai/gateway-contract';
import { expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { openSpaceBudgetWorkbook, saveSpaceWorkbook, saveSpaceWorkbookSchema } from '../budget-workbook.js';
import { changeSpaceItem, getSpaceItem, readSpaceContent } from '../repository.js';

it('saves immutable budget workbook versions and rejects stale edits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-budget-test-'));
  try {
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    const initial = openSpaceBudgetWorkbook();
    if (initial === 'trashed') throw new Error('Unexpected trashed demo');
    expect(openSpaceBudgetWorkbook()).toEqual(initial);
    const readSnapshot = async (versionId: string) => {
      const content = await readSpaceContent(initial.id, versionId);
      expect(content?.version.mimeType).toBe(SPACE_WORKBOOK_MIME);
      if (!(content?.body instanceof Uint8Array)) throw new Error('Missing workbook body');
      return saveSpaceWorkbookSchema.parse({ baseVersionId: versionId, snapshot: JSON.parse(new TextDecoder().decode(content.body)) });
    };
    const update = await readSnapshot(initial.versionId);
    expect(update.snapshot.sheetOrder).toEqual(['summary', 'plan', 'actual']);
    expect(update.snapshot.sheets.summary.cellData[4][2].f).toBe('=Actual!B5');
    update.snapshot.sheets.actual.cellData[2][1].v = 2100;
    const saved = saveSpaceWorkbook(initial.id, update);
    if (typeof saved === 'string') throw new Error(saved);

    expect(saveSpaceWorkbook(initial.id, update)).toEqual(saved);
    expect(getSpaceItem(initial.id)?.versions.map(version => version.id)).toEqual([saved.versionId, initial.versionId]);
    expect((await readSnapshot(saved.versionId)).snapshot.sheets.actual.cellData[2][1].v).toBe(2100);
    expect((await readSnapshot(initial.versionId)).snapshot.sheets.actual.cellData[2][1].v).toBe(2600);
    update.snapshot.sheets.actual.cellData[2][1].v = 2000;
    expect(saveSpaceWorkbook(initial.id, update)).toBe('conflict');

    expect(changeSpaceItem(initial.id, 2, { trash: true })).toBe('ok');
    expect(openSpaceBudgetWorkbook()).toBe('trashed');
    expect(saveSpaceWorkbook(initial.id, { ...update, baseVersionId: saved.versionId })).toBe('conflict');
  } finally {
    closeXopcDatabase();
    await rm(dir, { recursive: true, force: true });
  }
});
