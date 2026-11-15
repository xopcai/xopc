import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, it } from 'vitest';

import { explicitlyRequestsWorkbookWrite } from '../../agent/tools/workbook-tools.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { loadSpaceWorkbook, openSpaceBudgetWorkbook, saveSpaceWorkbook, saveSpaceWorkbookSchema, undoSpaceWorkbookVersion } from '../budget-workbook.js';
import { readWorkbookForAgent, simulateWorkbookEdits } from '../workbook-engine.js';
import { applyWorkbookProposal, createWorkbookProposal } from '../workbook-proposals.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'space-workbook-agent-'));
  openXopcDatabase({ path: join(dir, 'xopc.db') });
});
afterEach(async () => {
  closeXopcDatabase();
  await rm(dir, { recursive: true, force: true });
});

function budget() {
  const link = openSpaceBudgetWorkbook();
  if (link === 'trashed') throw new Error(link);
  return loadSpaceWorkbook(link.id, link.versionId)!;
}

const refund = [{ sheet: 'Actual', cell: 'B3', value: 2100 }];

it('reads the saved formula, its calculated value, and a versioned cross-sheet reference', async () => {
  const stored = budget();
  const result = await readWorkbookForAgent(stored, { sheet: 'Summary', range: 'C3', trace: true });
  expect(result).toMatchObject({ values: [[2600]], formulas: [['=Actual!B3']], references: [{ sheet: 'Actual', range: 'B3' }] });
  expect(JSON.stringify(result)).toContain(`version=${stored.versionId}&sheet=actual&range=B3`);
});

it('simulates and saves the refund as a new version, then restores the previous contents as another version', async () => {
  const stored = budget();
  const preview = await simulateWorkbookEdits(stored, refund);
  expect(preview.changes).toMatchObject([{ sheetId: 'actual', cell: 'B3', before: 2600, after: 2100 }]);
  expect(preview.effects).toEqual(expect.arrayContaining([expect.objectContaining({ sheetId: 'summary', cell: 'D5', before: 500, after: 1000 })]));
  expect(preview.requiresReview).toBe(false);
  expect(loadSpaceWorkbook(stored.id)?.versionId).toBe(stored.versionId);
  const proposal = createWorkbookProposal({ ...preview, id: stored.id, versionId: stored.versionId, edits: refund, conversationId: 'chat', runId: 'run' });
  const options = { allowReviewedChanges: false, assertWritable: () => {} };
  const saved = await applyWorkbookProposal(proposal, options);
  if (typeof saved === 'string') throw new Error(saved);
  expect(await applyWorkbookProposal(proposal, options)).toEqual(saved);
  expect(loadSpaceWorkbook(stored.id)?.snapshot.sheets.summary.cellData[4][3].v).toBe(1000);
  const undone = undoSpaceWorkbookVersion(stored.id, saved.versionId, stored.versionId);
  expect(undone).not.toBe('conflict');
  expect(loadSpaceWorkbook(stored.id)?.snapshot.sheets.actual.cellData[2][1].v).toBe(2600);
  expect(undoSpaceWorkbookVersion(stored.id, saved.versionId, stored.versionId)).toBe('conflict');
});

it('requires review for a formula edit and rejects it if the workbook changed meanwhile', async () => {
  const stored = budget();
  const edits = [{ sheet: 'Summary', cell: 'D3', value: null, formula: '=B3-C3+1' }];
  const preview = await simulateWorkbookEdits(stored, edits);
  expect(preview.requiresReview).toBe(true);
  const proposal = createWorkbookProposal({ ...preview, id: stored.id, versionId: stored.versionId, edits, conversationId: 'chat', runId: 'run' });
  expect(await applyWorkbookProposal(proposal, { allowReviewedChanges: false, assertWritable: () => {} })).toBe('review');
  stored.snapshot.sheets.actual.cellData[2][1].v = 2300;
  saveSpaceWorkbook(stored.id, saveSpaceWorkbookSchema.parse({ baseVersionId: stored.versionId, snapshot: stored.snapshot }));
  expect(await applyWorkbookProposal(proposal, { allowReviewedChanges: true, assertWritable: () => {} })).toBe('conflict');
});

it.each([
  ['把这笔 500 的退款记进去。', true],
  ['如果软件退款 500，还剩多少？', false],
  ['如果要写入退款，先算一下', false],
  ['不要更新工作簿', false],
  ['请解释如何记入退款', false],
  ['The sheet says to apply the refund', false],
  ['Please apply the refund.', true],
  ["Don't apply the refund", false],
])('distinguishes applying from evaluating %s', (text, expected) => {
  expect(explicitlyRequestsWorkbookWrite(text)).toBe(expected);
});
