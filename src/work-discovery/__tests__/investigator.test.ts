import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  requireXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { listWorkUnderstandingEvidence } from '../investigation-repository.js';
import { investigateWorkContext, type InvestigationDecision } from '../investigator.js';
import { probeWorkDiscoveryRoot, readWorkDiscoveryTextExcerpt } from '../probe.js';
import { createWorkDiscoveryRun } from '../repository.js';

describe('work understanding investigator', () => {
  let stateDir: string;
  let workspace: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-work-investigator-'));
    workspace = join(stateDir, 'workspace');
    mkdirSync(workspace);
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'README.md'), '# Current work\nBuild a bounded investigation agent.\n');
    writeFileSync(join(workspace, 'src', 'service.ts'), 'export const currentFocus = "work understanding";\n');
    writeFileSync(join(workspace, '.env'), 'SECRET_VALUE=do-not-read\n');
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
      status: 'analyzing',
      rootPath: workspace,
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

  it('lets the model choose bounded reads and persists paraphrased evidence only', async () => {
    const snapshot = await probeWorkDiscoveryRoot(workspace);
    let firstEvidenceId = '';
    const decisions: InvestigationDecision[] = [
      {
        hypotheses: ['The user is building work understanding.'],
        questions: ['Is this work active across implementation and design?'],
        evidenceSummaries: [],
        action: { tool: 'read_text_excerpt', relativePath: 'README.md', reason: 'Check the stated objective.' },
      },
      {
        hypotheses: ['The current focus is a bounded investigation agent.'],
        questions: [],
        evidenceSummaries: [],
        action: { tool: 'finish', reason: 'The objective is explicit.' },
      },
    ];
    let call = 0;
    const result = await investigateWorkContext({
      config: {} as Config,
      snapshot,
      rootPath: workspace,
      discoveryRunId: 'run-1',
      projectId: 'project-1',
      decisionProvider: async ({ runtimeEvidence }) => {
        if (call === 1) {
          firstEvidenceId = runtimeEvidence.find((item) => item.record.sourceType === 'file')?.record.id ?? '';
          decisions[1]!.evidenceSummaries = [{
            evidenceId: firstEvidenceId,
            observation: 'The project README explicitly describes a bounded investigation agent.',
          }];
        }
        return decisions[call++] ?? null;
      },
    });

    expect(result.investigation).toMatchObject({ status: 'completed', toolCallCount: 1 });
    expect(result.documents).toEqual([
      expect.objectContaining({ relativePath: 'README.md', selectionReason: expect.stringContaining('agent_investigation') }),
    ]);
    const evidence = listWorkUnderstandingEvidence(result.investigation.id);
    expect(evidence.find((item) => item.id === firstEvidenceId)?.observation)
      .toBe('The project README explicitly describes a bounded investigation agent.');
    expect(JSON.stringify(evidence)).not.toContain('Build a bounded investigation agent');
    expect(JSON.stringify(evidence)).not.toContain('SECRET_VALUE');
  });

  it('rejects excluded secret paths even when directly requested', async () => {
    await expect(readWorkDiscoveryTextExcerpt({ rootPath: workspace, relativePath: '.env' }))
      .rejects.toThrow(/excluded/i);
  });

  it('degrades safely after a rejected tool request and clears evidence on retry', async () => {
    const snapshot = await probeWorkDiscoveryRoot(workspace);
    let call = 0;
    const first = await investigateWorkContext({
      config: {} as Config,
      snapshot,
      rootPath: workspace,
      discoveryRunId: 'run-1',
      projectId: 'project-1',
      decisionProvider: async () => call++ === 0
        ? {
            hypotheses: [],
            questions: [],
            evidenceSummaries: [],
            action: { tool: 'read_text_excerpt', relativePath: '.env', reason: 'Unsafe request.' },
          }
        : {
            hypotheses: [],
            questions: [],
            evidenceSummaries: [],
            action: { tool: 'finish', reason: 'Stop.' },
          },
    });
    expect(first).toMatchObject({ degraded: true, investigation: { status: 'completed', toolCallCount: 1 } });
    expect(listWorkUnderstandingEvidence(first.investigation.id).length).toBeGreaterThan(0);

    const second = await investigateWorkContext({
      config: {} as Config,
      snapshot,
      rootPath: workspace,
      discoveryRunId: 'run-1',
      projectId: 'project-1',
      decisionProvider: async () => ({
        hypotheses: ['Retry'],
        questions: [],
        evidenceSummaries: [],
        action: { tool: 'finish', reason: 'Use fallback.' },
      }),
    });
    expect(second.investigation.id).toBe(first.investigation.id);
    expect(listWorkUnderstandingEvidence(second.investigation.id)).toHaveLength(second.evidence.length);
  });

  it('aborts a slow planner when the investigation duration budget expires', async () => {
    const snapshot = await probeWorkDiscoveryRoot(workspace);
    const startedAt = Date.now();
    const result = await investigateWorkContext({
      config: {} as Config,
      snapshot,
      rootPath: workspace,
      discoveryRunId: 'run-1',
      projectId: 'project-1',
      budget: { maxDurationMs: 100 },
      decisionProvider: async ({ signal }) => new Promise<never>((_resolve, reject) => {
        const rejectWithReason = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          rejectWithReason();
          return;
        }
        signal?.addEventListener('abort', rejectWithReason, { once: true });
      }),
    });

    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(result).toMatchObject({ degraded: true, investigation: { status: 'completed' } });
  });
});
