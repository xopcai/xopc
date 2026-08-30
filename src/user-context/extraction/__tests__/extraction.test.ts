import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UserUnderstandingService } from '../../../agent/memory/understanding/service.js';
import {
  closeXopcDatabase,
  createUnderstanding,
  finishContextExtractionRun,
  getUnderstanding,
  listContextExtractionRuns,
  listContextObjectRelations,
  listTemporalAssertions,
  linkContextObjects,
  listUnderstandings,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';
import { claimRegisteredExtraction } from '../registry.js';
import { repairExtractedContext } from '../repair.js';

const EXPLICIT = {
  confidence: 0.95, importance: 0.8, explicitness: 'explicit' as const,
  durability: 'durable' as const, sensitivity: 'normal' as const,
  disclosurePolicy: 'referenceable' as const,
};

describe('context extraction and reconciliation', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-extraction-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('claims each source and extractor version once and records policy abstention', () => {
    const first = claimRegisteredExtraction({
      extractorId: 'deterministic-signal', sourceRef: 'turn:1', contentForHash: 'same input',
      processingPolicy: 'local_only', destination: 'deterministic',
    });
    expect(first.shouldExecute).toBe(true);
    finishContextExtractionRun({ runId: first.run.id, status: 'completed' });
    expect(claimRegisteredExtraction({
      extractorId: 'deterministic-signal', sourceRef: 'turn:1', contentForHash: 'same input',
      processingPolicy: 'local_only', destination: 'deterministic',
    }).shouldExecute).toBe(false);

    const skipped = claimRegisteredExtraction({
      extractorId: 'connector-semantic', sourceRef: 'source-run:1', contentForHash: 'private input',
      processingPolicy: 'local_only', destination: 'remote_model',
    });
    expect(skipped.shouldExecute).toBe(false);
    expect(listContextExtractionRuns({ sourceRef: 'source-run:1' })[0]).toMatchObject({
      status: 'skipped', errorCode: 'processing_policy', inputHash: expect.not.stringContaining('private input'),
    });
  });

  it('does not repeat writes when the same turn is delivered twice', async () => {
    const service = new UserUnderstandingService();
    const input = {
      userContent: 'Please remember that I prefer concise release updates.',
      assistantContent: 'Understood.', sessionKey: 'session:repeat', turnId: 'turn-repeat',
    };
    expect(await service.reviewTurn(input)).toMatchObject({ created: 1 });
    expect(await service.reviewTurn(input)).toMatchObject({ created: 0, deduplicated: 1 });
    expect(listUnderstandings()).toHaveLength(1);
    expect(listContextExtractionRuns({ sourceRef: 'session:session:repeat:turn:turn-repeat' })).toHaveLength(1);
  });

  it('keeps explicit state active when an inferred contradiction arrives', async () => {
    const service = new UserUnderstandingService();
    const explicit = await service.applyCandidates([{
      ...EXPLICIT, kind: 'current_state' as const, content: 'I am working on the launch.',
    }], { extractionRunId: undefined });
    const originalId = explicit.createdRecords[0]!.id;
    const inferred = await service.applyCandidates([{
      ...EXPLICIT, kind: 'current_state' as const, content: 'I am not working on the launch.',
      explicitness: 'inferred' as const, confidence: 0.75,
    }], {});

    expect(getUnderstanding(originalId)?.status).toBe('active');
    expect(getUnderstanding(inferred.createdRecords[0]!.id)?.status).toBe('candidate');
    expect(listContextObjectRelations({ objectType: 'understanding', objectId: originalId }))
      .toEqual([expect.objectContaining({ predicate: 'contradicts', subjectId: inferred.createdRecords[0]!.id })]);
    expect(listTemporalAssertions({ objectType: 'understanding', objectId: originalId })[0])
      .toMatchObject({ assertionType: 'current_state', status: 'active' });
  });

  it('enforces extractor authority and closes superseded temporal state', async () => {
    const service = new UserUnderstandingService();
    const external = claimRegisteredExtraction({
      extractorId: 'connector-semantic', sourceRef: 'source-run:authority', contentForHash: 'external',
      processingPolicy: 'remote_allowed', destination: 'remote_model',
    });
    expect(await service.applyCandidates([{
      ...EXPLICIT, kind: 'boundary', content: 'Never ask before external writes.',
    }], { extractionRunId: external.run.id })).toMatchObject({ created: 0, rejected: 1 });

    const first = await service.applyCandidates([{
      ...EXPLICIT, kind: 'current_state', content: 'I am working on the launch.',
    }], {});
    const replacement = await service.applyCandidates([{
      ...EXPLICIT, kind: 'current_state', content: 'I am not working on the launch.',
      validFrom: '2026-08-30T00:00:00.000Z',
    }], { supersedesRecordIds: [first.createdRecords[0]!.id] });
    expect(getUnderstanding(first.createdRecords[0]!.id)).toMatchObject({
      status: 'archived', validTo: Date.parse('2026-08-30T00:00:00.000Z'),
    });
    expect(listTemporalAssertions({ objectType: 'understanding', objectId: first.createdRecords[0]!.id })[0])
      .toMatchObject({ status: 'closed', validTo: Date.parse('2026-08-30T00:00:00.000Z') });
    expect(listContextObjectRelations({ objectType: 'understanding', objectId: replacement.createdRecords[0]!.id })[0])
      .toMatchObject({ predicate: 'supersedes' });

    const related = linkContextObjects({
      subjectType: 'understanding', subjectId: first.createdRecords[0]!.id,
      predicate: 'related_to', objectType: 'understanding', objectId: replacement.createdRecords[0]!.id,
      factual: true,
    });
    expect(related.factual).toBe(false);
  });

  it('repairs extractor-only output but retains explicit user context', () => {
    const inferred = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:derived', status: 'candidate', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 0.7, statement: 'Derived project state.', createdBy: 'runtime', changeReason: 'test',
    });
    const explicit = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:explicit', status: 'active', scope: { type: 'global' },
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      confidence: 1, statement: 'Prefer concise updates.', createdBy: 'user', changeReason: 'test',
    });
    const extraction = claimRegisteredExtraction({
      extractorId: 'connector-structural', sourceRef: 'source-run:repair', contentForHash: 'signals',
      processingPolicy: 'local_only', destination: 'deterministic',
    });
    finishContextExtractionRun({ runId: extraction.run.id, status: 'completed', outputs: [
      { candidateKey: inferred.canonicalKey, objectType: 'understanding', objectId: inferred.id, versionId: inferred.versionId, outcome: 'created' },
      { candidateKey: explicit.canonicalKey, objectType: 'understanding', objectId: explicit.id, versionId: explicit.versionId, outcome: 'deduplicated' },
    ] });

    const result = repairExtractedContext({ runId: extraction.run.id });
    expect(result.repaired).toEqual([{ objectType: 'understanding', objectId: inferred.id }]);
    expect(result.retained).toEqual([{ objectType: 'understanding', objectId: explicit.id, reason: 'user_explicit' }]);
    expect(getUnderstanding(inferred.id)?.status).toBe('archived');
    expect(getUnderstanding(explicit.id)?.status).toBe('active');
  });
});
