import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import { ProjectService } from '../../projects/project-service.js';
import type { SessionIndex } from '../../session/manager.js';
import {
  closeXopcDatabase,
  createContextEvidence,
  createUnderstanding,
  getUnderstanding,
  linkUnderstandingEvidence,
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import {
  findActiveWorkDiscoverySourceRefresh,
  recordWorkDiscoverySourceRefresh,
} from '../incremental-repository.js';
import {
  createWorkDiscoveryRun,
  getWorkDiscoveryRun,
  setWorkDiscoveryFeedback,
} from '../repository.js';
import { WorkDiscoveryService } from '../service.js';
import {
  listWorkDiscoveryDirectorySources,
  revokeWorkDiscoveryDirectorySource,
  upsertWorkDiscoveryDirectorySource,
} from '../source-repository.js';

describe('work discovery repository', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-discovery-repository-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const { db } = requireXopcDatabase();
    db.prepare(
      `INSERT INTO projects (project_id, name, slug, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('project-1', 'Project', 'project', 1, 1);
    db.prepare(
      `INSERT INTO sessions (
        session_key, agent_id, session_id, created_at, updated_at, last_accessed_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('session-1', 'main', 'session-id-1', 1, 1, 1);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists recognition feedback with the discovery run', () => {
    createWorkDiscoveryRun({
      id: 'run-1',
      idempotencyKey: 'key-1',
      source: 'onboarding_selected_directory',
      status: 'completed',
      stage: 'next_steps',
      rootPath: '/workspace',
      projectId: 'project-1',
      sessionKey: 'session-1',
      agentId: 'main',
      modelRef: 'provider/model',
      scanPolicyVersion: 1,
      createdAt: 1,
      completedAt: 2,
    });

    setWorkDiscoveryFeedback({
      runId: 'run-1',
      recognitionDecision: 'corrected',
      correctedIntent: 'Finish onboarding first',
      nowMs: 3,
    });

    expect(getWorkDiscoveryRun('run-1')?.feedback).toEqual({
      runId: 'run-1',
      recognitionDecision: 'corrected',
      correctedIntent: 'Finish onboarding first',
      createdAt: 3,
      updatedAt: 3,
    });
  });

  it('activates only accepted work-discovery profile candidates', () => {
    const record = createUnderstanding({
      kind: 'project_context', canonicalKey: 'work-discovery:technology:test', scope: { type: 'project', id: 'project-1' },
      status: 'candidate',
      explicitness: 'inferred',
      durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 0.9,
      statement: 'The user works mainly with TypeScript.', createdBy: 'runtime', changeReason: 'test',
    });
    const evidence = createContextEvidence({ sourceType: 'runtime', sourceRef: 'work-discovery:run-2:candidate-1', trustLevel: 'trusted', observedAt: 1 });
    linkUnderstandingEvidence(record.versionId, evidence.id, 'supports', 0.9);
    createWorkDiscoveryRun({
      id: 'run-2',
      idempotencyKey: 'key-2',
      source: 'onboarding_selected_directory',
      status: 'completed',
      stage: 'next_steps',
      rootPath: '/workspace',
      projectId: 'project-1',
      sessionKey: 'session-1',
      agentId: 'main',
      modelRef: 'provider/model',
      scanPolicyVersion: 1,
      result: {
        projectSummary: 'A TypeScript project.',
        currentState: 'Active.',
        uncertainties: [],
        suggestions: [],
        profileCandidates: [{
          id: 'candidate-1',
          understandingId: record.id,
          category: 'technology',
          statement: record.statement,
          confidence: 'high',
          evidence: ['package.json'],
          status: 'pending',
        }],
      },
      createdAt: 1,
      completedAt: 2,
    });
    const service = new WorkDiscoveryService({
      projects: new ProjectService(),
      sessions: {} as SessionIndex,
      getConfig: () => ({}) as Config,
      emit: () => {},
    });

    const updated = service.updateProfileCandidates({
      runId: 'run-2',
      decisions: [{ id: 'candidate-1', status: 'edited', statement: 'I primarily build TypeScript products.' }],
    });

    expect(updated?.result?.profileCandidates?.[0]).toMatchObject({
      status: 'edited',
      statement: 'I primarily build TypeScript products.',
    });
    expect(getUnderstanding(record.id)).toMatchObject({
      status: 'active',
      statement: 'I primarily build TypeScript products.',
    });
  });

  it('persists and revokes read-only directory sources', () => {
    const source = upsertWorkDiscoveryDirectorySource({
      rootPath: '/workspace',
      displayName: 'workspace',
      fingerprint: {
        branch: 'main',
        changedFileCount: 2,
        recentAreas: ['src/work-discovery'],
        generatedAt: 10,
      },
      nowMs: 10,
    });

    expect(listWorkDiscoveryDirectorySources()).toEqual([
      expect.objectContaining({ id: source.id, rootPath: '/workspace', scope: { readOnly: true } }),
    ]);
    expect(revokeWorkDiscoveryDirectorySource(source.id, 20)).toMatchObject({ status: 'revoked', updatedAt: 20 });
    expect(listWorkDiscoveryDirectorySources()).toEqual([]);
  });

  it('finds an active queued refresh even when a newer check exists', () => {
    const source = upsertWorkDiscoveryDirectorySource({
      rootPath: '/refresh-workspace',
      displayName: 'refresh-workspace',
      nowMs: 10,
    });
    createWorkDiscoveryRun({
      id: 'run-refresh',
      idempotencyKey: 'key-refresh',
      source: 'manual_selected_directory',
      status: 'queued',
      rootPath: '/refresh-workspace',
      projectId: 'project-1',
      sessionKey: 'session-1',
      agentId: 'main',
      modelRef: 'provider/model',
      scanPolicyVersion: 1,
      createdAt: 10,
    });
    const fingerprint = {
      branch: 'main',
      changedFileCount: 1,
      recentAreas: ['src'],
      contentSignature: 'matching-signature',
      generatedAt: 10,
    };
    const queued = recordWorkDiscoverySourceRefresh({
      sourceId: source.id,
      changed: true,
      currentFingerprint: fingerprint,
      status: 'queued',
      discoveryRunId: 'run-refresh',
      checkedAt: 10,
    });
    recordWorkDiscoverySourceRefresh({
      sourceId: source.id,
      changed: false,
      currentFingerprint: fingerprint,
      status: 'checked',
      checkedAt: 20,
    });

    expect(findActiveWorkDiscoverySourceRefresh(source.id, fingerprint)?.id).toBe(queued.id);
    expect(findActiveWorkDiscoverySourceRefresh(source.id, {
      ...fingerprint,
      contentSignature: 'different-signature',
    })).toBeNull();
  });

  it('activates only understanding candidates produced by connected sources', () => {
    const notesRecord = createUnderstanding({
      kind: 'routine', canonicalKey: 'work-discovery:workflow:notes', scope: { type: 'global' },
      status: 'candidate',
      explicitness: 'inferred',
      durability: 'recurring',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 0.8,
      statement: 'The user regularly plans product work in notes.', createdBy: 'runtime', changeReason: 'test',
    });
    const notesEvidence = createContextEvidence({ sourceType: 'runtime', sourceRef: 'understanding-source:onboarding:notes', trustLevel: 'trusted', observedAt: 1 });
    linkUnderstandingEvidence(notesRecord.versionId, notesEvidence.id, 'supports', 0.8);
    const unrelatedRecord = createUnderstanding({
      kind: 'derived_insight', canonicalKey: 'work-discovery:other', scope: { type: 'global' },
      status: 'candidate',
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8,
      statement: 'Unrelated candidate.', createdBy: 'runtime', changeReason: 'test',
    });
    const otherEvidence = createContextEvidence({ sourceType: 'runtime', sourceRef: 'work-discovery:run:other', trustLevel: 'trusted', observedAt: 1 });
    linkUnderstandingEvidence(unrelatedRecord.versionId, otherEvidence.id, 'supports', 0.8);
    const service = new WorkDiscoveryService({
      projects: new ProjectService(),
      sessions: {} as SessionIndex,
      getConfig: () => ({}) as Config,
      emit: () => {},
    });

    const decisions = service.updateUnderstandingSourceProfile({ decisions: [
      { understandingId: notesRecord.id, status: 'accepted' },
      { understandingId: unrelatedRecord.id, status: 'accepted' },
    ] });

    expect(decisions).toHaveLength(1);
    expect(getUnderstanding(notesRecord.id)?.status).toBe('active');
    expect(getUnderstanding(unrelatedRecord.id)?.status).toBe('candidate');
  });
});
