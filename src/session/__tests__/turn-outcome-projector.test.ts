import { describe, expect, it } from 'vitest';

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

describe('turn outcome projector', () => {
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
