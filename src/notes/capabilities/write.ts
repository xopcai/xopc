import { NoteCreateInputSchema, NoteGetOutputSchema, NoteUpdateInputSchema, NoteAppendInputSchema, NoteRestoreInputSchema, NoteCaptureInputSchema, NoteDeleteInputSchema, NoteDeleteOutputSchema } from '@xopcai/gateway-contract';

import { ObjectLinkService } from '../../activity/service.js';
import { CapabilityError, defineAtomicCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import { NoteRevisionConflictError, type NotesService } from '../service.js';
import type { ProjectService } from '../../projects/index.js';
import type { Note } from '../types.js';

export function registerNoteWriteCapabilities(dispatcher: CapabilityDispatcher, deps: {
  getNotes: () => NotesService;
  getProjects?: () => ProjectService | undefined;
}): void {
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.delete', majorVersion: 1, description: 'Delete a note at an exact revision, revoke shares by default, and durably queue file cleanup after commit.',
    effect: 'local-write', surfaces: ['http', 'agent'], scopes: ['workspace.write'],
    input: NoteDeleteInputSchema, output: NoteDeleteOutputSchema,
    execute({ id, expectedRevision, revokeShares }) {
      try {
        const result = deps.getNotes().deleteNoteAtomically(id, expectedRevision, revokeShares);
        if (!result.deleted) throw new CapabilityError('NOT_FOUND', 'Note not found');
        return { deleted: true as const, revokedShares: result.revokedShares };
      } catch (error) {
        if (error instanceof NoteRevisionConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
        throw error;
      }
    },
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
  const result = (execute: () => Note | null) => {
    try {
      const note = execute();
      if (!note) throw new CapabilityError('NOT_FOUND', 'Note or snapshot not found');
      return { note: { ...note } };
    } catch (error) {
      if (error instanceof NoteRevisionConflictError) throw new CapabilityError('REVISION_CONFLICT', error.message);
      throw error;
    }
  };
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.capture', majorVersion: 1, description: 'Capture text with a durable receipt.',
    effect: 'local-write', surfaces: ['http'], scopes: ['workspace.write'],
    input: NoteCaptureInputSchema, output: NoteGetOutputSchema,
    execute: (input, context) => result(() => deps.getNotes().quickCaptureAtomically(input.text, input.capturedVia, context.idempotencyKey)),
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.append', majorVersion: 1, description: 'Append text once without replacing concurrent content.',
    effect: 'local-write', surfaces: ['http', 'agent', 'extension'], scopes: ['workspace.write'],
    input: NoteAppendInputSchema, output: NoteGetOutputSchema,
    execute: input => result(() => deps.getNotes().appendTextToNoteAtomically(input.id, input.content, input.heading, input.expectedRevision)),
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.restore', majorVersion: 1, description: 'Restore a snapshot at an exact current note revision.',
    effect: 'local-write', surfaces: ['http'], scopes: ['workspace.write'],
    input: NoteRestoreInputSchema, output: NoteGetOutputSchema,
    execute: input => result(() => deps.getNotes().restoreNoteSnapshotAtomically(input.id, input.timestamp, input.expectedRevision)),
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.create', majorVersion: 1, description: 'Create a note with a durable receipt and optional project link.',
    effect: 'local-write', surfaces: ['http', 'agent', 'extension'], scopes: ['workspace.write'],
    input: NoteCreateInputSchema, output: NoteGetOutputSchema,
    execute({ projectId, ...input }, context) {
      const project = projectId ? deps.getProjects?.()?.get(projectId) : undefined;
      if (projectId && !project) throw new CapabilityError('NOT_FOUND', 'Project not found');
      const note = deps.getNotes().createNoteAtomically(input, context.idempotencyKey);
      if (project) new ObjectLinkService().create({ id: `note:${note.id}:project:${project.id}`,
        from: { kind: 'note', id: note.id, title: note.title }, to: { kind: 'project', id: project.id, title: project.name },
        relation: 'belongs_to', source: 'user' });
      return { note: { ...note } };
    },
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
  dispatcher.register(defineAtomicCapability({
    id: 'xopc.notes.update', majorVersion: 1, description: 'Update a note at an exact revision; file cleanup is durable and post-commit.',
    effect: 'local-write', surfaces: ['http', 'agent', 'extension'], scopes: ['workspace.write'],
    input: NoteUpdateInputSchema, output: NoteGetOutputSchema,
    execute(input, context) {
      return result(() => deps.getNotes().updateNoteAtomically(input.id, input.patch as Partial<Note>, context.surface === 'agent' ? 'ai_edit' : input.trigger ?? 'edit', input.expectedRevision));
    },
    afterCommit() { deps.getNotes().flushCommittedEffects(); },
  }));
}
