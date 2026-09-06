import { describe, expect, it } from 'vitest';
import { fileResourceArtifactUri, type TurnOutcome, type TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import type { TranscriptStoredRow } from '../session-context-for-llm.js';
import { backfillStructuredTurnOutcomes, projectTurnOutcome } from '../turn-outcome-projector.js';

function toolResult(turnId: string, details: Record<string, unknown>): TranscriptStoredRow {
  return {
    role: 'toolResult',
    turnId,
    toolCallId: 'tool-1',
    toolName: 'publish_artifacts',
    content: [{ type: 'text', text: 'done' }],
    details,
    timestamp: 1,
  } as TranscriptStoredRow;
}

const sourceFileId = 'space.cmVwb3J0Lmh0bWw';

function published(artifactId: string, source = sourceFileId): TurnOutcomeDeliverable {
  return {
    artifactId, sourceFileId: source, title: 'report.html', kind: 'site',
    availability: 'available', location: 'artifact_store', capabilities: ['preview', 'download'],
    uri: `media://outbound/${artifactId}.html`,
  };
}

function written(source = sourceFileId): TranscriptStoredRow {
  return toolResult('turn-1', {
    delivery: {
      version: 1, operation: 'updated',
      primary: { kind: 'file', id: source, title: 'report.html', capabilities: ['preview'] },
    },
  });
}

describe('turn outcome projector', () => {
  it('does not infer passing checks from command names or stale tool evidence', () => {
    const rows = [
      { ...toolResult('turn-1', { command: 'echo test', exitCode: 0 }), toolName: 'exec_command' },
      { type: 'custom', customType: 'coding_verification', turnId: 'turn-1', data: {
        changed: true, revision: 'new', evidence: [{ kind: 'check', command: 'pnpm test', toolCallId: 'check', revision: 'old', status: 'unverified' }],
      } },
    ] as TranscriptStoredRow[];
    const outcome = projectTurnOutcome({ rows, turnId: 'turn-1' });
    expect(outcome.status).toBe('partial');
    expect(outcome.evidence).toHaveLength(1);
    expect(outcome.evidence[0]?.status).toBe('warning');
  });

  it.each([false, true])('prefers the published file regardless of row order (reversed: %s)', (reversed) => {
    const artifact = published('snapshot');
    const rows = [written(), toolResult('turn-1', { artifacts: [artifact] })];
    const outcome = projectTurnOutcome({ turnId: 'turn-1', rows: reversed ? rows.reverse() : rows });
    expect(outcome.deliverables).toEqual([artifact]);
  });

  it('keeps the latest successful publication without duplicating the workspace file', () => {
    const latest = published('latest');
    const failure = { ...published('failed'), availability: 'failed', uri: undefined };
    const outcome = projectTurnOutcome({
      turnId: 'turn-1',
      rows: [written(), toolResult('turn-1', { artifacts: [published('first'), latest, failure] })],
    });
    expect(outcome.deliverables).toEqual([latest]);
  });

  it('retains the workspace file when publishing fails and keeps unrelated failures visible', () => {
    const failure = { ...published('failed'), availability: 'failed', uri: undefined };
    const unrelated = { ...failure, artifactId: 'other-failed', sourceFileId: 'another-file' };
    const outcome = projectTurnOutcome({
      turnId: 'turn-1', rows: [written(), toolResult('turn-1', { artifacts: [failure, unrelated] })],
    });
    expect(outcome.deliverables).toHaveLength(2);
    expect(outcome.deliverables[0]).toMatchObject({ location: 'workspace', availability: 'available' });
    expect(outcome.deliverables[1]).toEqual(unrelated);
    expect(outcome.status).toBe('partial');
  });

  it('does not turn a publication failure into success when its duplicate is hidden', () => {
    const rows = [written(), toolResult('turn-1', {
      artifacts: [{ ...published('failed'), availability: 'failed', uri: undefined }],
    })];
    const outcome = projectTurnOutcome({ turnId: 'turn-1', rows });
    expect(outcome.deliverables).toHaveLength(1);
    expect(outcome.status).toBe('partial');
    const imported = backfillStructuredTurnOutcomes([
      ...rows, { type: 'custom', customType: 'turn_outcome', data: { ...outcome, status: 'succeeded' } },
    ] as TranscriptStoredRow[]);
    expect(imported.at(-1)).toMatchObject({ data: { status: 'partial' } });
  });

  it('does not merge same-named files from different directories, spaces, or unknown sources', () => {
    const artifacts = [
      published('one'), published('two', 'space.ZG9jcy9yZXBvcnQuaHRtbA'),
      published('three', 'other.cmVwb3J0Lmh0bWw'),
      { ...published('unidentified'), sourceFileId: undefined },
    ];
    const outcome = projectTurnOutcome({ turnId: 'turn-1', rows: [toolResult('turn-1', { artifacts })] });
    expect(outcome.deliverables).toEqual(artifacts);
  });

  it('deduplicates within a turn only', () => {
    const rows = [
      toolResult('turn-1', { artifacts: [published('first')] }),
      toolResult('turn-2', { artifacts: [published('second')] }),
    ];
    expect(projectTurnOutcome({ turnId: 'turn-1', rows }).deliverables).toEqual([published('first')]);
    expect(projectTurnOutcome({ turnId: 'turn-2', rows }).deliverables).toEqual([published('second')]);
  });

  it.each([false, true])('normalizes saved outcomes without bringing duplicates back (tool rows: %s)', (includeTools) => {
    const latest = published('latest');
    const saved: TurnOutcome = {
      ...projectTurnOutcome({ turnId: 'turn-1', rows: [] }),
      deliverables: [
        { ...latest, artifactId: sourceFileId, sourceFileId: undefined, location: 'workspace', uri: fileResourceArtifactUri(sourceFileId) },
        published('first'), latest,
      ],
    };
    const rows = [
      ...(includeTools ? [written(), toolResult('turn-1', { artifacts: [published('first'), latest] })] : []),
      { type: 'custom', customType: 'turn_outcome', data: saved },
    ] as TranscriptStoredRow[];
    const normalized = backfillStructuredTurnOutcomes(rows);
    expect(parseOutcome(normalized.at(-1)!).deliverables).toEqual([latest]);
    expect(backfillStructuredTurnOutcomes(normalized)).toEqual(normalized);
  });

  it('projects only structured artifact details', () => {
    const outcome = projectTurnOutcome({
      turnId: 'turn-1',
      rows: [
        toolResult('turn-1', { path: '/workspace/report.xlsx' }),
        toolResult('turn-1', {
          artifacts: [{
            artifactId: 'report-id',
            title: 'report.xlsx',
            kind: 'spreadsheet',
            availability: 'available',
            location: 'artifact_store',
            capabilities: ['preview', 'download'],
            uri: 'media://outbound/report-id.xlsx',
          }],
        }),
      ],
    });

    expect(outcome.deliverables).toHaveLength(1);
    expect(outcome.deliverables[0]?.artifactId).toBe('report-id');
  });

  it('includes primary and related file references without a URI for failed delivery', () => {
    const outcome = projectTurnOutcome({
      turnId: 'turn-1',
      rows: [toolResult('turn-1', {
        delivery: {
          version: 1,
          operation: 'failed',
          primary: { kind: 'file', id: 'space.cmVwb3J0Lnhsc3g', title: 'report.xlsx', capabilities: ['preview'] },
          related: [{ kind: 'file', id: 'space.ZGV0YWlscy5jc3Y', title: 'details.csv', capabilities: [] }],
        },
      })],
    });

    expect(outcome.status).toBe('partial');
    expect(outcome.deliverables).toHaveLength(2);
    expect(outcome.deliverables.every((item) => item.uri === undefined)).toBe(true);
  });

  it('marks opaque historical file references as missing instead of inventing a URI', () => {
    const outcome = projectTurnOutcome({
      turnId: 'turn-1',
      rows: [toolResult('turn-1', {
        delivery: {
          version: 1,
          operation: 'created',
          primary: { kind: 'file', id: 'opaque-id', title: 'report.xlsx', capabilities: ['preview'] },
        },
      })],
    });

    expect(outcome.status).toBe('partial');
    expect(outcome.deliverables[0]).toMatchObject({
      artifactId: 'opaque-id',
      availability: 'missing',
      location: 'external_host',
      capabilities: ['regenerate'],
    });
    expect(outcome.deliverables[0]).not.toHaveProperty('uri');
  });

  it('uses the final revision receipt after a failed check is repaired', () => {
    const result = projectTurnOutcome({ turnId: 'turn-1', rows: [
      { role: 'toolResult', turnId: 'turn-1', toolName: 'exec_command', isError: true,
        details: { verification: { kind: 'check', command: 'pnpm test', status: 'failed' } } },
      { type: 'custom', turnId: 'turn-1', customType: 'coding_verification',
        data: { changed: true, evidence: [{ kind: 'check', command: 'pnpm test', toolCallId: 'retry', status: 'passed' }] } },
    ] as TranscriptStoredRow[] });
    expect(result.status).toBe('succeeded');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.status).toBe('passed');
  });

  it('does not certify checks without a final workspace snapshot', () => {
    const result = projectTurnOutcome({ turnId: 'turn-1', rows: [
      { role: 'toolResult', turnId: 'turn-1', toolName: 'exec_command',
        details: { verification: { kind: 'check', command: 'pnpm test', status: 'passed' } } },
    ] as TranscriptStoredRow[] });
    expect(result.status).toBe('partial');
    expect(result.evidence[0]?.status).toBe('warning');
  });

  it('inserts a projected outcome immediately after its turn and remains idempotent', () => {
    const rows = [
      { role: 'user', turnId: 'turn-1', content: 'make report' },
      toolResult('turn-1', {
        media: [{ id: 'report-id', name: 'report.xlsx', uri: 'media://outbound/report-id.xlsx' }],
      }),
      { role: 'assistant', turnId: 'turn-1', content: 'done' },
      { role: 'user', turnId: 'turn-2', content: 'next' },
    ] as TranscriptStoredRow[];

    const once = backfillStructuredTurnOutcomes(rows);
    const twice = backfillStructuredTurnOutcomes(once);

    expect(once).toHaveLength(5);
    expect((once[3] as { customType?: string }).customType).toBe('turn_outcome');
    expect(twice).toEqual(once);
  });

  it('fills an existing empty outcome instead of adding a second one', () => {
    const rows = [
      toolResult('turn-1', {
        media: [{ id: 'report-id', name: 'report.xlsx', uri: 'media://outbound/report-id.xlsx' }],
      }),
      {
        type: 'custom',
        customType: 'turn_outcome',
        data: {
          version: 1,
          outcomeId: 'turn-1:outcome',
          runId: 'turn-1',
          turnId: 'turn-1',
          status: 'succeeded',
          deliverables: [],
          evidence: [],
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      },
    ] as TranscriptStoredRow[];

    const result = backfillStructuredTurnOutcomes(rows);
    expect(result).toHaveLength(2);
    expect(parseOutcome(result[1]).deliverables).toHaveLength(1);
  });
});

function parseOutcome(row: TranscriptStoredRow) {
  return (row as { data: { deliverables: unknown[] } }).data;
}
