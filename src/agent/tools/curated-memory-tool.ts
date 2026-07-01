// Curated memory tool — agent home `memories/MEMORY.md` + global `user/MEMORY.md` (session snapshot + live edits)
import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { MemoryManager } from '../memory/manager.js';

const CuratedMemorySchema = Type.Object({
  action: Type.Union([
    Type.Literal('add'),
    Type.Literal('propose'),
    Type.Literal('replace'),
    Type.Literal('remove'),
    Type.Literal('read'),
  ]),
  target: Type.Union([Type.Literal('memory'), Type.Literal('user')]),
  kind: Type.Optional(Type.Union([
    Type.Literal('user_profile'),
    Type.Literal('agent_note'),
    Type.Literal('workspace_fact'),
    Type.Literal('daily_note'),
    Type.Literal('session_summary'),
    Type.Literal('derived_insight'),
    Type.Literal('task_lesson'),
    Type.Literal('tool_preference'),
    Type.Literal('long_term_goal'),
  ])),
  sensitivity: Type.Optional(Type.Union([
    Type.Literal('normal'),
    Type.Literal('personal'),
    Type.Literal('secret'),
    Type.Literal('regulated'),
  ])),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  source_text: Type.Optional(Type.String({ description: 'Short evidence excerpt supporting a proposed memory.' })),
  content: Type.Optional(Type.String({ description: 'Required for add; new text for replace.' })),
  old_text: Type.Optional(
    Type.String({ description: 'Substring to match one entry for replace/remove.' }),
  ),
});

type CuratedMemoryParams = {
  action: 'add' | 'propose' | 'replace' | 'remove' | 'read';
  target: 'memory' | 'user';
  kind?: 'user_profile' | 'agent_note' | 'workspace_fact' | 'daily_note' | 'session_summary' | 'derived_insight' | 'task_lesson' | 'tool_preference' | 'long_term_goal';
  sensitivity?: 'normal' | 'personal' | 'secret' | 'regulated';
  confidence?: number;
  source_text?: string;
  content?: string;
  old_text?: string;
};

export function createCuratedMemoryTool(
  getMemoryManager: () => MemoryManager,
): AgentTool {
  return {
    name: 'curated_memory',
    label: 'Curated memory',
    description:
      'Read, edit, or propose bounded curated memory (MEMORY.md = agent notes, user/MEMORY.md = global user memory). Use propose when a memory should be reviewed by the user before it becomes active recall context. Entries are separated by a section-sign delimiter (see store format). System prompt shows a frozen snapshot from session start; this tool reads/writes live state on disk. Use add/replace/remove for structured updates; use read to inspect current entries.',
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

        if (action === 'propose') {
          const p = params as CuratedMemoryParams;
          const content = p.content?.trim() ?? '';
          const sourceText = p.source_text?.trim();
          const result = await memoryManager.write({
            kind: p.kind ?? (target === 'user' ? 'user_profile' : 'agent_note'),
            target,
            content,
            status: 'candidate',
            sensitivity: p.sensitivity ?? (target === 'user' ? 'personal' : 'normal'),
            confidence: p.confidence,
            evidence: sourceText ? [{ sourceText }] : undefined,
          });
          if (!result.success) {
            return {
              content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
              details: { error: result.error },
            };
          }
          return {
            content: [{ type: 'text', text: result.message ?? 'Memory candidate added to inbox' }],
            details: { success: true, recordId: result.record?.id, status: result.record?.status },
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
