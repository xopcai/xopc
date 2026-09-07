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
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { getUserAssertion, reconcileAssertion } from '../../user-model/index.js';
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
    const evidence = createContextEvidence({ sourceType: 'runtime', sourceRef: 'work-discovery:run-2:candidate-1', trustLevel: 'trusted', observedAt: 1 });
    const assertion = reconcileAssertion({
      subject: { type: 'user', id: 'self' },
      predicate: 'identity.work_discovery.role:typescript-builder',
      cardinality: 'single', scope: { type: 'project', id: 'project-1' }, kind: 'identity',
      value: 'The user works mainly with TypeScript.', normalizedValue: 'typescript builder',
      statement: 'The user works mainly with TypeScript.', authority: 'system_inferred',
      confidence: 0.9, inferredImportance: 0.6, consequence: 'low', actionability: 0.5,
      volatility: 'stable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      observedAt: 1, createdBy: 'runtime', evidenceId: evidence.id,
    }, 1).assertion;
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
          assertionId: assertion.id,
          category: 'role',
          factKey: 'role:typescript-builder',
          statement: assertion.statement,
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
    const updatedAssertion = getUserAssertion(updated!.result!.profileCandidates![0]!.assertionId!);
    expect(updatedAssertion).toMatchObject({
      status: 'active',
      statement: 'I primarily build TypeScript products.',
      supersedesAssertionId: assertion.id,
    });
  });

  it('persists and revokes read-only directory sources', () => {
    const source = upsertWorkDiscoveryDirectorySource({
      rootPath: '/workspace',
      displayName: 'workspace',
      processingPolicy: 'remote_allowed',
      fingerprint: {
        branch: 'main',
        changedFileCount: 2,
        recentAreas: ['src/work-discovery'],
        generatedAt: 10,
      },
      nowMs: 10,
    });

    expect(listWorkDiscoveryDirectorySources()).toEqual([
      expect.objectContaining({
        id: source.id,
        rootPath: '/workspace',
        scope: { readOnly: true },
        processingPolicy: 'remote_allowed',
      }),
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

});
