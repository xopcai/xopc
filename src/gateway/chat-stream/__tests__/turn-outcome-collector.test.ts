import { describe, expect, it } from 'vitest';

import type { ChatStreamEvent } from '../protocol.js';
import { TurnOutcomeCollector } from '../turn-outcome-collector.js';

function event<T extends ChatStreamEvent['type']>(
  type: T,
  payload: Extract<ChatStreamEvent, { type: T }>['payload'],
): Extract<ChatStreamEvent, { type: T }> {
  return {
    type,
    runId: 'run-1',
    sessionKey: 'agent:main:webchat:default:direct:chat-1',
    timestamp: 1,
    payload,
  } as Extract<ChatStreamEvent, { type: T }>;
}

describe('TurnOutcomeCollector', () => {
  it('separates explicit deliverables, code changes, and verification evidence', () => {
    const collector = new TurnOutcomeCollector('run-1');

    collector.capture(event('tool_end', {
      messageId: 'msg-1',
      toolCallId: 'write-1',
      toolName: 'write_file',
      status: 'success',
      activity: { category: 'file', action: 'write', status: 'completed' },
      result: { text: 'File written: /workspace/src/store.ts' },
    }));
    collector.capture(event('patch_applied', {
      messageId: 'msg-1',
      toolCallId: 'patch-1',
      changes: [{ kind: 'update', path: 'src/store.ts', added: 5, removed: 2 }],
      diff: '--- a/src/store.ts\n+++ b/src/store.ts',
      added: 5,
      removed: 2,
    }));
    collector.capture(event('turn_diff', {
      messageId: 'msg-1',
      files: ['src/store.ts'],
      diff: '--- a/src/store.ts\n+++ b/src/store.ts',
      added: 5,
      removed: 2,
    }));
    collector.capture(event('command_completed', {
      messageId: 'msg-1',
      toolCallId: 'command-1',
      command: 'pnpm run typecheck',
      exitCode: 0,
      durationMs: 420,
    }));
    collector.capture(event('tool_end', {
      messageId: 'msg-1',
      toolCallId: 'image-1',
      toolName: 'image_generate',
      status: 'success',
      activity: { category: 'media', action: 'generate', status: 'completed' },
      result: {
        details: {
          artifacts: [{
            artifactId: 'image-id',
            title: 'result.png',
            kind: 'image',
            mimeType: 'image/png',
            sizeBytes: 128,
            availability: 'available',
            location: 'artifact_store',
            capabilities: ['preview', 'download'],
            uri: 'media://outbound/result.png',
          }],
        },
      },
    }));

    const outcome = collector.finalize('success');
    expect(outcome.deliverables).toEqual([
      expect.objectContaining({
        artifactId: 'image-id',
        title: 'result.png',
        kind: 'image',
      }),
    ]);
    expect(outcome.changeSet).toMatchObject({
      files: [{ path: 'src/store.ts', status: 'modified', added: 5, removed: 2 }],
      added: 5,
      removed: 2,
    });
    expect(outcome.evidence).toEqual([
      expect.objectContaining({ status: 'passed', command: 'pnpm run typecheck' }),
    ]);
    expect(outcome.status).toBe('succeeded');
  });

  it('does not infer deliverables from write_file or apply_patch outputs', () => {
    const collector = new TurnOutcomeCollector('run-1');
    collector.capture(event('tool_end', {
      messageId: 'msg-1',
      toolCallId: 'write-1',
      toolName: 'write_file',
      status: 'success',
      activity: { category: 'file', action: 'write', status: 'completed' },
      result: {
        text: 'File written: /workspace/report.pdf',
        details: { path: '/workspace/report.pdf' },
      },
    }));

    expect(collector.finalize('success').deliverables).toEqual([]);
  });

  it('aggregates the canonical file ProductDelivery into the turn outcome', () => {
    const collector = new TurnOutcomeCollector('run-1');
    collector.capture(event('tool_end', {
      messageId: 'msg-1',
      toolCallId: 'write-1',
      toolName: 'write_file',
      status: 'success',
      activity: { category: 'file', action: 'write', status: 'completed' },
      result: {
        details: {
          delivery: {
            version: 1,
            operation: 'updated',
            primary: {
              kind: 'file',
              id: 'space-id.cmVwb3J0cy9zYWxlcy54bHN4',
              title: 'sales.xlsx',
              capabilities: ['preview', 'share'],
            },
          },
        },
      },
    }));

    expect(collector.finalize('success').deliverables).toEqual([{
      artifactId: 'space-id.cmVwb3J0cy9zYWxlcy54bHN4',
      title: 'sales.xlsx',
      kind: 'spreadsheet',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      availability: 'available',
      location: 'workspace',
      capabilities: ['preview', 'download', 'share'],
      uri: 'xopc-file:space-id.cmVwb3J0cy9zYWxlcy54bHN4',
      workspaceRelativePath: 'reports/sales.xlsx',
    }]);
  });

  it('marks the result partial when a verification command fails', () => {
    const collector = new TurnOutcomeCollector('run-1');
    collector.capture(event('command_completed', {
      messageId: 'msg-1',
      toolCallId: 'command-1',
      command: 'pnpm test',
      exitCode: 1,
    }));

    const outcome = collector.finalize('success');
    expect(outcome.status).toBe('partial');
    expect(outcome.evidence[0]?.status).toBe('failed');
  });
});
