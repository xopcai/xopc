import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { claimResearchCheckpoint, createResearchCheckpoint, finishResearchCheckpoint, getResearchCheckpoint, recordResearchEvidence, recordResearchSearch, saveResearchCheckpoint } from '../research-checkpoint-repository.js';

const conversationId = 'aabf5ef6-72f6-4d10-8127-43ae78e9449e';
const workspace = '/tmp/research';
const finding = { id: 'vendor-price', subject: 'Vendor', field: 'price', status: 'not_disclosed' as const,
  conclusion: 'Contact sales', sources: [{ url: 'https://example.com/pricing', title: 'Pricing' }] };

describe('research checkpoints', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'research-checkpoint-'));
    path = join(root, 'xopc.db');
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path });
    ensureSessionRecord(conversationId, workspace, { agentId: 'main' });
  });
  afterEach(() => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true });
  });
  it('retains incremental findings, evidence and unfinished work across reopen', () => {
    const created = createResearchCheckpoint(conversationId, workspace, 'Research Vendor');
    const claimed = claimResearchCheckpoint(created, 60_000);
    saveResearchCheckpoint(claimed, { findings: [finding], nextSteps: ['Check concurrency'] });
    recordResearchEvidence(claimed, { toolCallId: 'fetch-1', toolName: 'web_fetch', isError: false, excerpt: 'Public pricing page', recordedAt: Date.now() });
    finishResearchCheckpoint(claimed, 'partial', 'deadline_exceeded', 'Price unavailable');
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path });
    const resumed = claimResearchCheckpoint(getResearchCheckpoint(created.id, conversationId, workspace)!, 60_000);
    const checkpoint = saveResearchCheckpoint(resumed, { findings: [{ ...finding, id: 'vendor-concurrency', field: 'concurrency' }], nextSteps: [] });
    expect(checkpoint.findings).toHaveLength(2);
    expect(checkpoint.evidence[0]?.excerpt).toBe('Public pricing page');
    expect(checkpoint.nextSteps).toEqual([]);
    expect(resumed.attempts).toBe(2);
  });
  it('persists task-scoped search results across reopen while retaining their original capture time', () => {
    const record = claimResearchCheckpoint(createResearchCheckpoint(conversationId, workspace, 'Research'), 60_000);
    recordResearchSearch(record, { key: 'search-key', query: 'Vendor official pricing', count: 5, provider: 'brave', capturedAt: 123,
      results: [{ title: 'Pricing', url: 'https://example.com/pricing', description: 'Contact sales' }] });
    finishResearchCheckpoint(record, 'partial', 'deadline_exceeded', 'Continue');
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path });
    expect(getResearchCheckpoint(record.id, conversationId, workspace)?.checkpoint.searches).toMatchObject([{ key: 'search-key', capturedAt: 123 }]);
    const resumed = claimResearchCheckpoint(getResearchCheckpoint(record.id, conversationId, workspace)!, 60_000);
    saveResearchCheckpoint(resumed, { findings: [finding], nextSteps: [] });
    expect(getResearchCheckpoint(record.id, conversationId, workspace)?.checkpoint.searches).toHaveLength(1);
  });
  it('scopes reads to the owning conversation and workspace', () => {
    const record = createResearchCheckpoint(conversationId, workspace, 'Research');
    expect(getResearchCheckpoint(record.id, 'another-conversation', workspace)).toBeUndefined();
    expect(getResearchCheckpoint(record.id, conversationId, '/another-workspace')).toBeUndefined();
  });
  it('rejects simultaneous resumes and fences callbacks from a recovered lease', () => {
    const record = createResearchCheckpoint(conversationId, workspace, 'Research');
    const first = claimResearchCheckpoint(record, 60_000);
    expect(() => claimResearchCheckpoint(record, 60_000)).toThrow('already running');
    const recovered = claimResearchCheckpoint(record, 60_000, Date.now() + 60_001);
    expect(() => saveResearchCheckpoint(first, { findings: [finding], nextSteps: [] })).toThrow('lease expired');
    expect(() => finishResearchCheckpoint(first, 'partial', 'timeout', '')).toThrow('lease was replaced');
    saveResearchCheckpoint(recovered, { findings: [finding], nextSteps: [] });
  });
  it('validates source evidence and preserves the last valid checkpoint on invalid updates', () => {
    const record = claimResearchCheckpoint(createResearchCheckpoint(conversationId, workspace, 'Research'), 60_000);
    saveResearchCheckpoint(record, { findings: [finding], nextSteps: ['Check concurrency'] });
    expect(() => saveResearchCheckpoint(record, { findings: [{ ...finding, status: 'confirmed', sources: [] }], nextSteps: [] })).toThrow('source evidence');
    expect(() => saveResearchCheckpoint(record, { findings: [{ ...finding, sources: [{ url: 'file:///etc/passwd', title: 'Invalid' }] }], nextSteps: [] })).toThrow('HTTP(S)');
    expect(getResearchCheckpoint(record.id, conversationId, workspace)?.checkpoint.nextSteps).toEqual(['Check concurrency']);
  });
  it('bounds evidence and never resumes a completed checkpoint', () => {
    const record = claimResearchCheckpoint(createResearchCheckpoint(conversationId, workspace, 'Research'), 60_000);
    for (let n = 0; n < 35; n++) recordResearchEvidence(record, { toolCallId: String(n), toolName: 'web_fetch', isError: false, excerpt: 'a'.repeat(4000), recordedAt: n });
    const checkpoint = getResearchCheckpoint(record.id, conversationId, workspace)!.checkpoint;
    expect(checkpoint.evidence).toHaveLength(30);
    expect(checkpoint.evidence[0]?.excerpt).toHaveLength(2000);
    finishResearchCheckpoint(record, 'completed', 'completed', 'Done');
    expect(() => claimResearchCheckpoint(record, 60_000)).toThrow('complete');
  });
});
