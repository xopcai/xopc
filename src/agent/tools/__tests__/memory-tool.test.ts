import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemoryManager } from '../../memory/manager.js';
import { createMemorySearchTool } from '../memory-tool.js';

describe('memory_search recall signals', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('records unified recall evidence independently of Dreaming mode', async () => {
    root = await mkdtemp(join(tmpdir(), 'xopc-memory-tool-'));
    const recordSignal = vi.fn();
    const manager = {
      search: async () => [{
        record: {
          id: 'memory/note.md#L1-L1',
          kind: 'user_note',
          scope: { agentId: 'main' },
          content: 'Keep responses concise.',
          source: { path: 'memory/note.md', lineStart: 1, lineEnd: 1 },
          explicitness: 'explicit',
          durability: 'durable',
          importance: 0.8,
          disclosurePolicy: 'referenceable',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
        score: 0.9,
        snippet: 'Keep responses concise.',
        citation: {
          providerId: 'local',
          recordId: 'memory/note.md#L1-L1',
          path: 'memory/note.md',
          lineStart: 1,
          lineEnd: 1,
        },
      }],
      recordSignal,
    } as unknown as MemoryManager;
    const tool = createMemorySearchTool({
      workspaceDir: root,
      getMemoryManager: () => manager,
      shouldRecordDreamingRecalls: () => false,
    });

    await tool.execute('call-1', { query: 'response style' });

    expect(recordSignal).toHaveBeenCalledWith(expect.objectContaining({
      source: 'search_recall',
      recordId: 'memory/note.md#L1-L1',
      score: 0.9,
    }));
  });
});
