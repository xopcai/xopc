import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase, createUnderstanding, getUnderstanding, listUnderstandings,
  openXopcDatabase, resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import {
  extractExplicitUnderstandingCandidates, extractHighSignalUnderstandingCandidates, UserUnderstandingService,
} from '../understanding/service.js';

const BASE_CANDIDATE = {
  confidence: 0.9,
  importance: 0.8,
  explicitness: 'explicit' as const,
  durability: 'durable' as const,
  sensitivity: 'normal' as const,
  disclosurePolicy: 'referenceable' as const,
};

describe('UserUnderstandingService', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-service-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('extracts explicit intent and ignores ordinary turns', () => {
    const candidates = extractExplicitUnderstandingCandidates(
      'Please remember that I prefer pnpm over npm for this repo.',
    );
    expect(candidates[0]).toMatchObject({
      kind: 'preference', content: 'I prefer pnpm over npm for this repo.', explicitness: 'explicit',
    });
    expect(extractExplicitUnderstandingCandidates('Can you explain the gateway routes?')).toEqual([]);
  });

  it('keeps recurring high-signal preferences as candidates until the user confirms them', async () => {
    expect(extractExplicitUnderstandingCandidates('以后请直接执行，不用每次先问我。')).toEqual([]);
    const candidates = extractHighSignalUnderstandingCandidates('以后请直接执行，不用每次先问我。');
    expect(candidates[0]).toMatchObject({ kind: 'boundary', explicitness: 'observed' });

    const result = await new UserUnderstandingService().reviewTurn({
      userContent: '以后请直接执行，不用每次先问我。',
      assistantContent: '好的。',
      sessionKey: 'webchat:test',
    });
    expect(result.createdRecords[0]).toMatchObject({ status: 'candidate' });
    expect(getUnderstanding(result.createdRecords[0]!.id)?.status).toBe('candidate');
  });

  it('does not infer a durable preference from an ordinary one-off request', () => {
    expect(extractHighSignalUnderstandingCandidates('Please explain this route concisely.')).toEqual([]);
    expect(extractHighSignalUnderstandingCandidates('帮我直接修改这个文件。')).toEqual([]);
  });

  it('stores explicit understanding and deduplicates by canonical key and scope', async () => {
    const service = new UserUnderstandingService();
    const candidate = { ...BASE_CANDIDATE, kind: 'preference' as const, content: 'Prefer concise answers.', canonicalKey: 'preference:concise' };
    expect(await service.applyCandidates([candidate], {})).toMatchObject({ created: 1, deduplicated: 0 });
    expect(await service.applyCandidates([candidate], {})).toMatchObject({ created: 0, deduplicated: 1 });
    expect(listUnderstandings()).toHaveLength(1);
  });

  it('deduplicates small wording variations without merging opposite preferences', async () => {
    const service = new UserUnderstandingService();
    const first = await service.applyCandidates([
      { ...BASE_CANDIDATE, kind: 'preference', content: 'Prefer concise answers.' },
    ], {});
    expect(await service.applyCandidates([
      { ...BASE_CANDIDATE, kind: 'preference', content: 'I prefer concise answers.' },
    ], {})).toMatchObject({ created: 0, deduplicated: 1 });
    const opposite = await service.applyCandidates([
      { ...BASE_CANDIDATE, kind: 'preference', content: 'I do not prefer concise answers.' },
    ], {});
    expect(opposite).toMatchObject({ created: 1, deduplicated: 0 });
    expect(getUnderstanding(first.createdRecords[0]!.id)?.status).toBe('archived');
    expect(getUnderstanding(opposite.createdRecords[0]!.id)?.supersedesId).toBe(first.createdRecords[0]!.id);
  });

  it('scopes project facts to the workspace while keeping preferences global', async () => {
    const service = new UserUnderstandingService();
    await service.applyCandidates([
      { ...BASE_CANDIDATE, kind: 'preference', content: 'Prefer concise answers.' },
      { ...BASE_CANDIDATE, kind: 'project_context', content: 'This workspace uses pnpm.' },
    ], { workspaceId: '/workspace/a' });
    const items = listUnderstandings();
    expect(items.find((item) => item.kind === 'preference')?.scope).toEqual({ type: 'global' });
    expect(items.find((item) => item.kind === 'project_context')?.scope).toEqual({ type: 'workspace', id: '/workspace/a' });
  });

  it('archives the corrected understanding and links its replacement', async () => {
    const old = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:old', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: 'Prefer short answers.', createdBy: 'user', changeReason: 'test',
    });
    const service = new UserUnderstandingService();
    const result = await service.applyCandidates(extractExplicitUnderstandingCandidates(
      '你记错了我的偏好，我更喜欢详细解释。',
    ), { supersedesRecordIds: [old.id] });
    expect(result.created).toBe(1);
    expect(getUnderstanding(old.id)?.status).toBe('archived');
    expect(getUnderstanding(result.createdRecords[0]!.id)?.supersedesId).toBe(old.id);
  });

  it('rejects content that is declared or inferred to be sensitive', async () => {
    const service = new UserUnderstandingService();
    const result = await service.applyCandidates([
      { ...BASE_CANDIDATE, kind: 'current_state', content: 'My API key is sk-abcdefghijk.' },
      { ...BASE_CANDIDATE, kind: 'current_state', content: 'My bank account is 12345678.' },
      { ...BASE_CANDIDATE, kind: 'preference', content: 'Prefer concise status updates.' },
    ], {});
    expect(result).toMatchObject({ proposed: 3, created: 1, rejected: 2 });
    expect(listUnderstandings()).toHaveLength(1);
  });
});
