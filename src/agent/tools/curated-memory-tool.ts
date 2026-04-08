// Curated memory tool — `.xopcbot/memories/MEMORY.md` + `USER.md` (session snapshot + live edits)
import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

import type { BuiltinMemoryStore } from '../memory/builtin-memory-store.js';

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

export function createCuratedMemoryTool(getStore: () => BuiltinMemoryStore): AgentTool<
  typeof CuratedMemorySchema,
  {}
> {
  return {
    name: 'curated_memory',
    label: '🧠 Curated memory',
    description:
      'Read or edit bounded curated memory in `.xopcbot/memories/` (MEMORY.md = agent notes, USER.md = user profile). Entries are separated by a section-sign delimiter (see store format). System prompt shows a frozen snapshot from session start; this tool reads/writes live state on disk. Use add/replace/remove for structured updates; use read to inspect current entries.',
    parameters: CuratedMemorySchema,

    async execute(
      _toolCallId: string,
      params: Static<typeof CuratedMemorySchema>,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<{}>> {
      const store = getStore();
      const { action, target } = params;

      try {
        if (action === 'read') {
          const entries = store.getLiveEntries(target);
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
          const content = params.content?.trim() ?? '';
          const result = await store.add(target, content);
          if (!result.success) {
            return {
              content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
              details: { error: result.error },
            };
          }
          return {
            content: [{ type: 'text', text: result.message ?? 'OK' }],
            details: { success: true },
          };
        }

        if (action === 'replace') {
          const oldText = params.old_text?.trim() ?? '';
          const newContent = params.content?.trim() ?? '';
          const result = await store.replace(target, oldText, newContent);
          if (!result.success) {
            return {
              content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
              details: { error: result.error },
            };
          }
          return {
            content: [{ type: 'text', text: result.message ?? 'OK' }],
            details: { success: true },
          };
        }

        const oldText = params.old_text?.trim() ?? '';
        const result = await store.remove(target, oldText);
        if (!result.success) {
          return {
            content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
            details: { error: result.error },
          };
        }
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
  };
}
