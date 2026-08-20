import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SHORT_TERM_RECALL_STORE_RELATIVE } from '../../memory/dreaming/constants.js';
import type { MemoryManager } from '../../memory/manager.js';
import { createMemorySearchTool } from '../memory-tool.js';

describe('memory_search dreaming capture', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('does not collect recall evidence when dreaming is disabled', async () => {
    root = await mkdtemp(join(tmpdir(), 'xopc-memory-tool-'));
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
      recordSignal: () => undefined,
    } as unknown as MemoryManager;
    const tool = createMemorySearchTool({
      workspaceDir: root,
      dreamingRoot: root,
      getMemoryManager: () => manager,
      shouldRecordDreamingRecalls: () => false,
    });

    await tool.execute('call-1', { query: 'response style' });

    await expect(access(join(root, SHORT_TERM_RECALL_STORE_RELATIVE))).rejects.toThrow();
  });
});
