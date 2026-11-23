import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';
import {
  appendProductDeliveryText,
  NoteGetOutputSchema,
  PRODUCT_DELIVERY_VERSION,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import { CapabilityDispatcher, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { registerNoteWriteCapabilities } from '../../notes/capabilities/write.js';
import { isPersonalConversation } from '../../personal-agent/repository.js';
import { getEmbeddedExecutionSession } from '../embedded/execution-context.js';
import type { XopcUseToolDeps } from './xopc-use-tool.js';

const PersonalNoteSchema = Type.Object({
  command: Type.Union([
    Type.Literal('create'),
    Type.Literal('append'),
    Type.Literal('update'),
  ]),
  noteId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Existing note ID for append or update.' })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 300, description: 'Short note title for create or update.' })),
  markdown: Type.Optional(Type.String({ maxLength: 50_000, description: 'Markdown body for create or update.' })),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 50_000, description: 'Markdown snippet to append for command="append".' })),
  heading: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Optional section heading when appending.' })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 20 })),
  pinned: Type.Optional(Type.Boolean()),
  projectId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'Optional project ID to link on create.' })),
  expectedRevision: Type.Optional(Type.Integer({ minimum: 1, description: 'Original updatedAt timestamp from personal_read for optimistic concurrency.' })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false });

type PersonalNoteInput = Static<typeof PersonalNoteSchema>;

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{
      type: 'text' as const,
      text: appendProductDeliveryText(
        text,
        details.delivery as ProductDeliveryEnvelope | undefined,
      ),
    }],
    details,
  };
}

function noteDelivery(note: { id: string; title?: string; updatedAt: number }, operation: 'created' | 'updated'): ProductDeliveryEnvelope {
  return {
    version: PRODUCT_DELIVERY_VERSION,
    operation,
    primary: {
      kind: 'note',
      id: note.id,
      title: note.title || 'Untitled Note',
      revision: String(note.updatedAt),
      capabilities: ['open', 'edit'],
    },
  };
}

function summarizeNote(note: Record<string, unknown>) {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    pinned: note.pinned,
    revision: typeof note.remoteVersion === 'number' ? note.remoteVersion : 1,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
  };
}

export function createPersonalNoteTool(
  deps: Pick<XopcUseToolDeps, 'getNotesService' | 'getProjectService' | 'getCurrentConversationId' | 'getCurrentAgentId' | 'authorizeCapability'>,
): AgentTool<typeof PersonalNoteSchema, Record<string, unknown>> {
  const dispatcher = new CapabilityDispatcher();
  if (deps.getNotesService) {
    registerNoteWriteCapabilities(dispatcher, {
      getNotes: () => {
        const notes = deps.getNotesService!();
        if (!notes) throw new Error('Notes service unavailable');
        return notes;
      },
      getProjects: deps.getProjectService,
    });
  }

  return {
    name: 'personal_note',
    label: 'Personal Notes',
    description:
      'Create, append to, or update a local note directly in this personal conversation. '
      + 'Use for explicit requests to jot down a memo, save a summary as a note, or add an entry to an existing note (find existing note IDs with personal_read(kind="note")). '
      + 'Do not use for long-term user preferences or facts (use personal_memory instead), and delegate heavy multi-document writing or reorganization via personal_task. '
      + 'Only claim a note was saved after a successful tool result.',
    parameters: PersonalNoteSchema,
    async execute(toolCallId, params: PersonalNoteInput, signal) {
      const conversationId = getEmbeddedExecutionSession() ?? deps.getCurrentConversationId?.();
      if (!conversationId || !isPersonalConversation(conversationId)) {
        return textResult('Personal conversation is unavailable.', { ok: false });
      }
      const notes = deps.getNotesService?.();
      if (!notes) {
        return textResult('Notes service is unavailable.', { ok: false });
      }

      const call = async (operation: string, input: unknown) => {
        const caller: CapabilityContext = {
          principalId: `agent:${deps.getCurrentAgentId?.() ?? 'main'}`,
          surface: 'agent',
          conversationId,
          scopes: ['workspace.write'],
          allowedCapabilities: [operation],
          authorize: deps.authorizeCapability ?? (() => true),
          signal,
        };
        const raw = await dispatcher.call(operation, input, caller, {
          ...dispatcher.describe(operation, caller),
          idempotencyKey: params.idempotencyKey ?? toolCallId,
        });
        return NoteGetOutputSchema.parse(raw).note;
      };

      switch (params.command) {
        case 'create': {
          const markdown = (params.markdown ?? params.content ?? '').trim();
          const title = params.title?.trim();
          if (!title && !markdown) {
            return textResult('title or markdown content is required to create a note.', { ok: false });
          }
          const note = await call('xopc.notes.create', {
            ...(title ? { title } : {}),
            markdown,
            ...(params.tags ? { tags: params.tags } : {}),
            ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
            ...(params.projectId ? { projectId: params.projectId } : {}),
            capturedVia: { channel: 'web' },
          });
          const summary = summarizeNote(note as unknown as Record<string, unknown>);
          return textResult(JSON.stringify({ ok: true, note: summary }), {
            ok: true,
            note: summary,
            delivery: noteDelivery(note, 'created'),
          });
        }

        case 'append': {
          const id = params.noteId?.trim();
          const content = (params.content ?? params.markdown)?.trim();
          if (!id) return textResult('noteId is required for append.', { ok: false });
          if (!content) return textResult('content is required for append.', { ok: false });
          const note = await call('xopc.notes.append', {
            id,
            content,
            ...(params.heading?.trim() ? { heading: params.heading.trim() } : {}),
            ...(params.expectedRevision !== undefined ? { expectedRevision: params.expectedRevision } : {}),
          });
          const summary = summarizeNote(note as unknown as Record<string, unknown>);
          return textResult(JSON.stringify({ ok: true, note: summary }), {
            ok: true,
            note: summary,
            delivery: noteDelivery(note, 'updated'),
          });
        }

        case 'update': {
          const id = params.noteId?.trim();
          if (!id) return textResult('noteId is required for update.', { ok: false });
          const patch: Record<string, unknown> = {};
          if (params.title !== undefined) patch.title = params.title.trim();
          if (params.markdown !== undefined) patch.markdown = params.markdown;
          if (params.tags !== undefined) patch.tags = params.tags;
          if (params.pinned !== undefined) patch.pinned = params.pinned;
          if (Object.keys(patch).length === 0) {
            return textResult('At least one field (title, markdown, tags, pinned) is required for update.', { ok: false });
          }
          const existing = params.expectedRevision === undefined ? await notes.getNote(id) : undefined;
          if (params.expectedRevision === undefined && !existing) {
            return textResult(`Note not found: ${id}`, { ok: false });
          }
          const expectedRevision = params.expectedRevision ?? (existing?.remoteVersion ?? 1);
          const note = await call('xopc.notes.update', {
            id,
            expectedRevision,
            trigger: 'ai_edit',
            patch,
          });
          const summary = summarizeNote(note as unknown as Record<string, unknown>);
          return textResult(JSON.stringify({ ok: true, note: summary }), {
            ok: true,
            note: summary,
            delivery: noteDelivery(note, 'updated'),
          });
        }
      }
    },
  };
}
