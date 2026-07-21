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
  createWorkDiscoveryRun,
  getWorkDiscoveryRun,
  setWorkDiscoveryFeedback,
} from '../repository.js';

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
});
