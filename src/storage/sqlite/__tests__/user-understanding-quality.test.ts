import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemoryTraceEvent,
  closeXopcDatabase,
  findLatestMemoryInjectTrace,
  getMemoryRecord,
  listMemoryTraceEvents,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  summarizeUserUnderstandingQuality,
  setMemoryTraceFeedback,
  setLatestMemoryInjectFeedback,
  upsertMemoryRecord,
} from '../index.js';

describe('summarizeUserUnderstandingQuality', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-understanding-quality-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('aggregates the global candidate funnel and recall feedback', () => {
    const nowMs = Date.UTC(2026, 6, 16);
    const active = upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      workspaceId: '/tmp/main',
      content: 'Prefer concise answers.',
      tags: ['user-understanding'],
      status: 'active',
      explicitness: 'explicit',
      confidence: 0.9,
      nowMs: nowMs - 24 * 60 * 60 * 1000,
    });
    upsertMemoryRecord({
      providerId: 'local',
      kind: 'routine',
      sourceAgentId: 'main',
      workspaceId: '/tmp/main',
      content: 'Reviews plans on Fridays.',
      tags: ['user-understanding'],
      status: 'rejected',
      explicitness: 'inferred',
      confidence: 0.7,
      nowMs: nowMs - 2 * 24 * 60 * 60 * 1000,
    });
    upsertMemoryRecord({
      providerId: 'local',
      kind: 'project_context',
      sourceAgentId: 'main',
      workspaceId: '/tmp/main',
      content: 'Works on xopc.',
      tags: ['user-understanding'],
      status: 'candidate',
      explicitness: 'inferred',
      confidence: 0.8,
      nowMs: nowMs - 8 * 24 * 60 * 60 * 1000,
    });
    upsertMemoryRecord({
      providerId: 'local',
      kind: 'workspace_fact',
      sourceAgentId: 'main',
      workspaceId: '/tmp/main',
      content: 'Not an understanding record.',
      tags: ['other'],
      status: 'active',
      nowMs,
    });
    upsertMemoryRecord({
      providerId: 'local',
      kind: 'boundary',
      sourceAgentId: 'main',
      workspaceId: '/tmp/main',
      content: 'Do not send external messages.',
      tags: ['user-understanding'],
      status: 'candidate',
      explicitness: 'explicit',
      confidence: 0.8,
      nowMs: nowMs - 60 * 24 * 60 * 60 * 1000,
    });
    appendMemoryTraceEvent({
      phase: 'understanding',
      providerId: 'user-understanding',
      sessionKey: 'agent:main:webchat:test',
      sourceAgentId: 'main',
      request: { source: 'background', proposed: 4, created: 2, deduplicated: 1, rejected: 1 },
      resultCount: 2,
      nowMs,
    });
    appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'local',
      selectedRecordIds: [active.id],
      feedback: {
        rating: 'helpful',
        source: 'user',
        createdAt: new Date(nowMs).toISOString(),
      },
      nowMs,
    });

    const metrics = summarizeUserUnderstandingQuality({ nowMs, windowDays: 30 });

    expect(metrics.attempts).toEqual({ total: 1, turn: 0, background: 1 });
    expect(metrics.candidates).toEqual({ proposed: 4, created: 2, deduplicated: 1, rejectedByPolicy: 1 });
    expect(metrics.records).toMatchObject({
      total: 4,
      candidate: 2,
      active: 1,
      rejected: 1,
      agingCandidates: 2,
      explicit: 2,
      inferred: 2,
      averageConfidence: 0.8,
    });
    expect(metrics.decisions).toEqual({ total: 2, acceptanceRate: 0.5 });
    expect(metrics.recall).toMatchObject({ total: 1, helpful: 1, helpfulRate: 1 });
  });

  it('attributes response feedback to the latest inject trace before the assistant timestamp', () => {
    const nowMs = Date.UTC(2026, 6, 16);
    const olderTraceId = appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'user-understanding',
      sessionKey: 'agent:main:webchat:test',
      selectedRecordIds: ['memory-1'],
      nowMs: nowMs - 2_000,
    });
    appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'user-understanding',
      sessionKey: 'agent:main:webchat:test',
      selectedRecordIds: [],
      nowMs,
    });

    const attributed = setLatestMemoryInjectFeedback({
      sessionKey: 'agent:main:webchat:test',
      beforeMs: nowMs - 1_000,
      feedback: { rating: 'helpful', source: 'user' },
      nowMs,
    });
    expect(attributed?.traceId).toBe(olderTraceId);
    expect(attributed?.feedback?.rating).toBe('helpful');
    const replaced = setLatestMemoryInjectFeedback({
      sessionKey: 'agent:main:webchat:test',
      beforeMs: nowMs - 1_000,
      feedback: { rating: 'not_helpful', source: 'user' },
      nowMs: nowMs + 1,
    });
    expect(replaced?.traceId).toBe(olderTraceId);
    expect(replaced?.feedback?.rating).toBe('not_helpful');

    const correctionTarget = findLatestMemoryInjectTrace({
      sessionKey: 'agent:main:webchat:test',
      beforeMs: nowMs + 1,
      requireSelectedRecords: true,
    });
    expect(correctionTarget).toBeNull();
    expect(findLatestMemoryInjectTrace({
      sessionKey: 'agent:main:webchat:test',
      beforeMs: nowMs - 1_000,
      requireSelectedRecords: true,
    })?.traceId).toBe(olderTraceId);
  });

  it('moves an active understanding to review only after repeated net-negative feedback', () => {
    const nowMs = Date.UTC(2026, 6, 16);
    const record = upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer concise answers.',
      tags: ['user-understanding'],
      status: 'active',
      confidence: 0.9,
      nowMs: nowMs - 10_000,
    });
    const firstTraceId = appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'local',
      selectedRecordIds: [record.id],
      nowMs: nowMs - 2_000,
    });
    const secondTraceId = appendMemoryTraceEvent({
      phase: 'inject',
      providerId: 'local',
      selectedRecordIds: [record.id],
      nowMs: nowMs - 1_000,
    });

    const firstUpdate = setMemoryTraceFeedback({
      traceId: firstTraceId,
      feedback: { rating: 'not_helpful', source: 'user' },
      nowMs,
    });
    expect(firstUpdate?.remediation?.needsReviewRecordIds).toEqual([]);
    expect(getMemoryRecord(record.id)?.status).toBe('active');

    const secondUpdate = setMemoryTraceFeedback({
      traceId: secondTraceId,
      feedback: { rating: 'not_helpful', source: 'user' },
      nowMs: nowMs + 1,
    });
    expect(secondUpdate?.remediation?.needsReviewRecordIds).toEqual([record.id]);
    expect(getMemoryRecord(record.id)).toMatchObject({ status: 'needs_review', confidence: 0.7 });
    expect(listMemoryTraceEvents({ phase: 'remediation' })).toHaveLength(1);

    const repeated = setMemoryTraceFeedback({
      traceId: secondTraceId,
      feedback: { rating: 'not_helpful', source: 'user' },
      nowMs: nowMs + 2,
    });
    expect(repeated?.remediation?.needsReviewRecordIds).toEqual([]);
    expect(getMemoryRecord(record.id)?.confidence).toBe(0.7);
    expect(listMemoryTraceEvents({ phase: 'remediation' })).toHaveLength(1);
  });

  it('archives the corrected record only when its replacement candidate is approved', () => {
    const nowMs = Date.UTC(2026, 6, 16);
    const previous = upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer concise answers.',
      tags: ['user-understanding'],
      status: 'needs_review',
      confidence: 0.7,
      nowMs,
    });
    const replacement = upsertMemoryRecord({
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer detailed explanations.',
      tags: ['user-understanding', 'explicit-user-correction'],
      status: 'candidate',
      confidence: 0.95,
      supersedesRecordId: previous.id,
      nowMs: nowMs + 1,
    });

    expect(getMemoryRecord(previous.id)?.status).toBe('needs_review');
    upsertMemoryRecord({
      id: replacement.id,
      providerId: 'local',
      kind: replacement.kind,
      sourceAgentId: replacement.provenance.sourceAgentId,
      content: replacement.content,
      tags: replacement.tags,
      status: 'active',
      confidence: replacement.confidence,
      supersedesRecordId: previous.id,
      nowMs: nowMs + 2,
    });

    expect(getMemoryRecord(previous.id)).toMatchObject({ status: 'archived' });
    expect(getMemoryRecord(previous.id)?.validTo).toBe(new Date(nowMs + 2).toISOString());
    expect(getMemoryRecord(replacement.id)?.status).toBe('active');
  });
});
