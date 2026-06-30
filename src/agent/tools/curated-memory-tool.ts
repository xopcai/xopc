// Curated memory tool — agent home `memories/MEMORY.md` + global `user/MEMORY.md` (session snapshot + live edits)
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { MemoryManager } from '../memory/manager.js';

const CuratedMemorySchema = Type.Object({
  action: Type.Union([
    Type.Literal('add'),
    Type.Literal('replace'),
    Type.Literal('remove'),
    Type.Literal('read'),
  ]),
  target: Type.Union([Type.Literal('memory'), Type.Literal('user')]),
  content: Type.Optional(Type.String({ description: 'Required for add; new text for replace.' })),
  old_text: Type.Optional(
    Type.String({ description: 'Substring to match one entry for replace/remove.' }),
  ),
});

type CuratedMemoryParams = {
  action: 'add' | 'replace' | 'remove' | 'read';
  target: 'memory' | 'user';
  content?: string;
  old_text?: string;
};

export function createCuratedMemoryTool(
  getMemoryManager: () => MemoryManager,
): AgentTool {
  return {
    name: 'curated_memory',
    label: '🧠 Curated memory',
    description:
      'Read or edit bounded curated memory (MEMORY.md = agent notes, user/MEMORY.md = global user memory). Entries are separated by a section-sign delimiter (see store format). System prompt shows a frozen snapshot from session start; this tool reads/writes live state on disk. Use add/replace/remove for structured updates; use read to inspect current entries.',
    parameters: CuratedMemorySchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const memoryManager = getMemoryManager();
      const { action, target } = params as CuratedMemoryParams;

      try {
        if (action === 'read') {
          const records = await memoryManager.list({ target });
          const entries = records.map((record) => record.content);
          const text = JSON.stringify(
            { target, entries, count: entries.length },
            null,
            2,
          );
          return {
            content: [{ type: 'text', text }],
            details: { entries },
          };
        }

        if (action === 'add') {
          const content = (params as CuratedMemoryParams).content?.trim() ?? '';
          const result = await memoryManager.write({
            kind: target === 'user' ? 'user_profile' : 'agent_note',
            target,
            content,
          });
          if (!result.success) {
            return {
              content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
              details: { error: result.error },
            };
          }
          memoryManager.onMemoryWrite('add', target, content);
          return {
            content: [{ type: 'text', text: result.message ?? 'OK' }],
            details: { success: true },
          };
        }

        if (action === 'replace') {
          const oldText = (params as CuratedMemoryParams).old_text?.trim() ?? '';
          const newContent = (params as CuratedMemoryParams).content?.trim() ?? '';
          const result = await memoryManager.update({ target, matchText: oldText, content: newContent });
          if (!result.success) {
            return {
              content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
              details: { error: result.error },
            };
          }
          memoryManager.onMemoryWrite('replace', target, newContent);
          return {
            content: [{ type: 'text', text: result.message ?? 'OK' }],
            details: { success: true },
          };
        }

        const oldText = (params as CuratedMemoryParams).old_text?.trim() ?? '';
        const result = await memoryManager.delete({ target, matchText: oldText });
        if (!result.success) {
          return {
            content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
            details: { error: result.error },
          };
        }
        memoryManager.onMemoryWrite('remove', target, oldText);
        return {
          content: [{ type: 'text', text: result.message ?? 'OK' }],
          details: { success: true },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `curated_memory error: ${message}` }],
          details: { error: message },
        };
      }
    },
  } as any;
}
