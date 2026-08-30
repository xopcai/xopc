import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  createContextEvidence,
  createUnderstanding,
  getUnderstanding,
  linkUnderstandingEvidence,
  listContextConsolidationDecisions,
  listUnderstandingEvidence,
  listUnderstandings,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { runContextConsolidation } from '../consolidation.js';

describe('structured user context consolidation', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-consolidation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('moves an independently supported candidate to review without activating it', async () => {
    const candidate = createUnderstanding({
      kind: 'routine', canonicalKey: 'routine:weekly-plan', status: 'candidate', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'recurring', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'The user plans work weekly.',
      createdBy: 'connector', changeReason: 'test',
    });
    for (const sourceRef of ['calendar:event-1', 'notes:item-1']) {
      const evidence = createContextEvidence({
        sourceType: 'connector', sourceRef, trustLevel: 'untrusted', observedAt: 1,
      });
      linkUnderstandingEvidence(candidate.versionId, evidence.id, 'supports', 0.8);
    }

    const result = await runContextConsolidation({
      config: ConfigSchema.parse({}), triggerKind: 'schedule', now: 10,
    });

    expect(result.metrics).toEqual({ scanned: 1, needsReview: 1, stale: 0, globalCandidates: 0 });
    expect(getUnderstanding(candidate.id)?.status).toBe('needs_review');
    expect(listContextConsolidationDecisions(result.run.runId)).toEqual([
      expect.objectContaining({
        understandingId: candidate.id,
        action: 'needs_review',
        reasonCode: 'independent_evidence_threshold',
        evidenceCount: 2,
      }),
    ]);
  });

  it('marks expired active understanding stale', async () => {
    const understanding = createUnderstanding({
      kind: 'current_state', canonicalKey: 'state:launch', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'ephemeral', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 1, expiresAt: 9,
      statement: 'The launch is the current priority.', createdBy: 'user', changeReason: 'test',
    });
    await runContextConsolidation({ config: ConfigSchema.parse({}), triggerKind: 'manual', now: 10 });
    expect(getUnderstanding(understanding.id)?.status).toBe('stale');
  });

  it('sends contradictory evidence to review instead of counting it as support', async () => {
    const candidate = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:contradicted', status: 'candidate', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: 'referenceable', confidence: 0.8, statement: 'The user prefers weekly reports.',
      createdBy: 'connector', changeReason: 'test',
    });
    const supporting = createContextEvidence({
      sourceType: 'connector', sourceRef: 'notes:item-1', trustLevel: 'untrusted', observedAt: 1,
    });
    const contradicting = createContextEvidence({
      sourceType: 'conversation', sourceRef: 'turn:2', trustLevel: 'owner', observedAt: 2,
    });
    linkUnderstandingEvidence(candidate.versionId, supporting.id, 'supports', 0.8);
    linkUnderstandingEvidence(candidate.versionId, contradicting.id, 'contradicts', 1);

    const result = await runContextConsolidation({
      config: ConfigSchema.parse({}), triggerKind: 'schedule', now: 10,
    });

    expect(result.metrics).toEqual({ scanned: 1, needsReview: 1, stale: 0, globalCandidates: 0 });
    expect(getUnderstanding(candidate.id)?.status).toBe('needs_review');
    expect(listContextConsolidationDecisions(result.run.runId)).toEqual([
      expect.objectContaining({ reasonCode: 'contradictory_evidence', evidenceCount: 1 }),
    ]);
  });

  it('proposes a global preference only after confirmation in distinct projects', async () => {
    for (const [index, projectId] of ['project-1', 'project-2'].entries()) {
      const understanding = createUnderstanding({
        kind: 'preference', canonicalKey: 'preference:concise-updates', status: 'active',
        scope: { type: 'project', id: projectId }, explicitness: 'explicit', durability: 'durable',
        sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
        statement: 'Prefers concise progress updates.', createdBy: 'user', changeReason: 'test',
      });
      const evidence = createContextEvidence({
        sourceType: 'conversation', sourceRef: `turn:${index + 1}`, trustLevel: 'owner', observedAt: index + 1,
      });
      linkUnderstandingEvidence(understanding.versionId, evidence.id, 'supports', 1);
    }

    const first = await runContextConsolidation({
      config: ConfigSchema.parse({}), triggerKind: 'manual', now: 10,
    });
    const global = listUnderstandings(['candidate']).find((item) => item.scope.type === 'global');

    expect(first.metrics.globalCandidates).toBe(1);
    expect(global).toMatchObject({
      canonicalKey: 'preference:concise-updates', status: 'candidate', explicitness: 'inferred',
    });
    expect(listUnderstandingEvidence(global!.id, 'supports')).toHaveLength(2);

    const second = await runContextConsolidation({
      config: ConfigSchema.parse({}), triggerKind: 'manual', now: 11,
    });
    expect(second.metrics.globalCandidates).toBe(0);
  });

  it('does not globalize project items that were corrected to different statements', async () => {
    for (const [projectId, statement] of [
      ['project-1', 'Prefers concise progress updates.'],
      ['project-2', 'Prefers detailed progress updates.'],
    ]) {
      createUnderstanding({
        kind: 'preference', canonicalKey: 'preference:progress-updates', status: 'active',
        scope: { type: 'project', id: projectId }, explicitness: 'explicit', durability: 'durable',
        sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
        statement, createdBy: 'user', changeReason: 'test',
      });
    }

    const result = await runContextConsolidation({
      config: ConfigSchema.parse({}), triggerKind: 'manual', now: 10,
    });

    expect(result.metrics.globalCandidates).toBe(0);
    expect(listUnderstandings(['candidate'])).toEqual([]);
  });
});
