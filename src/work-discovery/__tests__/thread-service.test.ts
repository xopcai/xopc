import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  appendWorkUnderstandingEvidence,
  createWorkUnderstandingInvestigation,
} from '../investigation-repository.js';
import {
  deleteWorkUnderstandingDerivedData,
  getWorkUnderstandingSourceLineage,
} from '../governance.js';
import { createWorkDiscoveryRun } from '../repository.js';
import { upsertWorkDiscoveryDirectorySource } from '../source-repository.js';
import { persistWorkThreadsFromDiscovery } from '../thread-service.js';
import {
  addWorkUnderstandingThreadFeedback,
  attachWorkUnderstandingThreadEvidence,
  listWorkUnderstandingThreads,
  upsertWorkUnderstandingThread,
} from '../thread-repository.js';
import type { WorkContextSnapshot, WorkDiscoveryResult } from '../types.js';

describe('work understanding threads', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-threads-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const { db } = requireXopcDatabase();
    db.prepare(
      `INSERT INTO projects (project_id, name, slug, created_at, updated_at)
       VALUES ('project-1', 'Project', 'project', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO sessions (
        session_key, agent_id, session_id, created_at, updated_at, last_accessed_at
       ) VALUES ('session-1', 'main', 'session-id-1', 1, 1, 1)`,
    ).run();
    createWorkDiscoveryRun({
      id: 'run-1',
      idempotencyKey: 'key-1',
      source: 'manual_selected_directory',
      status: 'completed',
      rootPath: '/workspace',
      projectId: 'project-1',
      sessionKey: 'session-1',
      agentId: 'main',
      modelRef: 'provider/model',
      scanPolicyVersion: 1,
      createdAt: 1,
    });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates evidence-backed threads and preserves explicit corrections on later inference', () => {
    const now = Date.UTC(2026, 7, 2);
    const investigation = createWorkUnderstandingInvestigation({
      discoveryRunId: 'run-1',
      budget: { maxToolCalls: 6, maxContentChars: 60_000, maxDurationMs: 25_000 },
      nowMs: now,
    });
    const evidence = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      projectId: 'project-1',
      sourceType: 'file',
      sourceRef: 'README.md',
      observation: 'The README describes the current onboarding implementation.',
      observedAt: now - 3_600_000,
      sensitivity: 'normal',
      collectedAt: now,
    });
    const snapshot: WorkContextSnapshot = {
      root: { displayName: 'Project', projectKind: 'coding', markerReasons: [] },
      structure: { sampledPaths: ['README.md'], metadataOnlyFiles: [], omittedPathCount: 0 },
      git: {
        changedPaths: ['README.md'],
        recentCommits: [
          { subject: 'day one', committedAt: now - 86_400_000 },
          { subject: 'day two', committedAt: now - 2 * 86_400_000 },
        ],
      },
      documents: [],
      limits: { policyVersion: 1, fileCount: 1, contentBytes: 0, truncated: false },
    };
    const result: WorkDiscoveryResult = {
      projectSummary: 'Onboarding project',
      currentState: 'Implementing work understanding.',
      uncertainties: [],
      suggestions: [],
      workThreadCandidates: [{
        topicKey: 'work-understanding',
        title: 'Build work understanding',
        summary: 'Implement the investigation and onboarding flow.',
        status: 'active',
        horizon: 'current',
        confidence: 'high',
        evidenceRefs: ['README.md'],
      }],
    };

    const [thread] = persistWorkThreadsFromDiscovery({
      projectId: 'project-1', result, snapshot, evidence: [evidence], nowMs: now,
    });
    expect(thread).toMatchObject({ horizon: 'current', projectIds: ['project-1'], evidenceIds: [evidence.id] });
    expect(thread!.focusScore).toBeGreaterThan(60);

    const corrected = addWorkUnderstandingThreadFeedback({
      threadId: thread!.id,
      decision: 'corrected',
      correctedTitle: 'Finish the work understanding agent',
      correctedSummary: 'The current goal is to finish the agent, not redesign onboarding.',
      nowMs: now + 1,
    });
    const inferredAgain = upsertWorkUnderstandingThread({
      canonicalKey: thread!.canonicalKey,
      title: 'Model changed this title',
      summary: 'Model changed this summary',
      status: 'active',
      horizon: 'current',
      focusScore: 70,
      confidence: 0.8,
      projectIds: ['project-1'],
      evidenceIds: [evidence.id],
      nowMs: now + 2,
    });
    expect(corrected?.userStatus).toBe('corrected');
    expect(inferredAgain).toMatchObject({
      title: 'Finish the work understanding agent',
      summary: 'The current goal is to finish the agent, not redesign onboarding.',
      userStatus: 'corrected',
    });

    const laterEvidence = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      projectId: 'project-1',
      sourceType: 'file',
      sourceRef: 'docs/plan.md',
      observation: 'The implementation plan shows the same work continuing.',
      observedAt: now + 10,
      sensitivity: 'normal',
      collectedAt: now + 10,
    });
    const [continued] = persistWorkThreadsFromDiscovery({
      projectId: 'project-1',
      result: {
        ...result,
        workThreadCandidates: [{
          ...result.workThreadCandidates![0]!,
          topicKey: 'agent-understanding-v2',
          title: 'Finish work understanding agent',
          evidenceRefs: ['docs/plan.md'],
        }],
      },
      snapshot,
      evidence: [laterEvidence],
      nowMs: now + 10,
    });
    expect(continued?.id).toBe(thread!.id);
    expect(continued?.evidenceIds).toEqual(expect.arrayContaining([evidence.id, laterEvidence.id]));

    const explicitEvidence = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      projectId: 'project-1',
      sourceType: 'user_statement',
      sourceRef: 'session://feedback',
      observation: 'The user confirmed this is the current focus.',
      sensitivity: 'normal',
    });
    const corroborated = attachWorkUnderstandingThreadEvidence({
      threadId: thread!.id,
      evidenceId: explicitEvidence.id,
      projectId: 'project-1',
      nowMs: now + 20,
    });
    expect(corroborated?.evidenceIds).toContain(explicitEvidence.id);
    expect(corroborated!.focusScore).toBeGreaterThan(continued!.focusScore);
  });

  it('falls back to an evidence-backed uncertain thread when model references are invalid', () => {
    const investigation = createWorkUnderstandingInvestigation({
      discoveryRunId: 'run-1',
      budget: { maxToolCalls: 6, maxContentChars: 60_000, maxDurationMs: 25_000 },
    });
    const evidence = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      projectId: 'project-1',
      sourceType: 'file',
      sourceRef: 'README.md',
      observation: 'The project has recent implementation activity.',
      sensitivity: 'normal',
    });
    const result: WorkDiscoveryResult = {
      projectSummary: 'Project activity',
      currentState: 'The exact focus needs confirmation.',
      uncertainties: ['The model cited an unread file.'],
      suggestions: [],
      lowConfidence: true,
      workThreadCandidates: [{
        topicKey: 'unsupported',
        title: 'Unsupported claim',
        summary: 'This claim has no matching evidence.',
        status: 'active',
        horizon: 'current',
        confidence: 'high',
        evidenceRefs: ['secret.txt'],
      }],
    };
    const threads = persistWorkThreadsFromDiscovery({
      projectId: 'project-1',
      result,
      snapshot: {
        root: { displayName: 'Project', projectKind: 'coding', markerReasons: [] },
        structure: { sampledPaths: [], metadataOnlyFiles: [], omittedPathCount: 0 },
        documents: [],
        limits: { policyVersion: 1, fileCount: 1, contentBytes: 0, truncated: false },
      },
      evidence: [evidence],
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ status: 'uncertain', evidenceIds: [evidence.id] });
  });

  it('hides rejected threads from the default current-work list', () => {
    const thread = upsertWorkUnderstandingThread({
      canonicalKey: 'project-1:current:test',
      title: 'Wrong focus',
      summary: 'This should be rejected.',
      status: 'uncertain',
      horizon: 'current',
      focusScore: 20,
      confidence: 0.5,
      projectIds: ['project-1'],
      evidenceIds: [],
    });
    addWorkUnderstandingThreadFeedback({ threadId: thread.id, decision: 'rejected' });
    expect(listWorkUnderstandingThreads()).toEqual([]);
    expect(listWorkUnderstandingThreads({ includeRejected: true })).toHaveLength(1);
  });

  it('deletes source-derived threads but retains explicitly confirmed understanding as uncertain', () => {
    const source = upsertWorkDiscoveryDirectorySource({
      rootPath: '/workspace',
      displayName: 'Workspace',
      fingerprint: {
        changedFileCount: 1,
        recentAreas: ['src'],
        contentSignature: 'abc',
        generatedAt: 1,
      },
    });
    const investigation = createWorkUnderstandingInvestigation({
      discoveryRunId: 'run-1',
      budget: { maxToolCalls: 1, maxContentChars: 100, maxDurationMs: 100 },
    });
    const evidence = appendWorkUnderstandingEvidence({
      investigationId: investigation.id,
      sourceGrantId: source.id,
      projectId: 'project-1',
      sourceType: 'file',
      sourceRef: 'README.md',
      observation: 'The source supports the inferred work.',
      sensitivity: 'normal',
    });
    const inferred = upsertWorkUnderstandingThread({
      canonicalKey: 'project-1:current:inferred',
      title: 'Inferred only',
      summary: 'Derived only from the source.',
      status: 'active',
      horizon: 'current',
      focusScore: 70,
      confidence: 0.8,
      projectIds: ['project-1'],
      evidenceIds: [evidence.id],
    });
    const confirmed = upsertWorkUnderstandingThread({
      canonicalKey: 'project-1:current:confirmed',
      title: 'Confirmed work',
      summary: 'The user confirmed this work.',
      status: 'active',
      horizon: 'current',
      focusScore: 80,
      confidence: 0.9,
      projectIds: ['project-1'],
      evidenceIds: [evidence.id],
    });
    addWorkUnderstandingThreadFeedback({ threadId: confirmed.id, decision: 'confirmed' });

    expect(getWorkUnderstandingSourceLineage(source.id)).toMatchObject({ evidenceCount: 1, threadCount: 2 });
    expect(deleteWorkUnderstandingDerivedData(source.id)).toMatchObject({
      evidenceCount: 1,
      deletedThreads: 1,
      retainedThreads: 1,
    });
    expect(listWorkUnderstandingThreads({ includeRejected: true }).find((thread) => thread.id === inferred.id)).toBeUndefined();
    expect(listWorkUnderstandingThreads().find((thread) => thread.id === confirmed.id)).toMatchObject({
      status: 'uncertain',
      confidence: 0.5,
    });
  });
});
