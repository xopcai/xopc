import {
  ProductReadContracts,
} from '@xopcai/gateway-contract';

import { CapabilityError, defineReadCapability, type CapabilityDispatcher } from '../../capabilities/runtime/dispatcher.js';
import type { NotesService } from '../service.js';

export function registerNoteReadCapabilities(dispatcher: CapabilityDispatcher, getNotes: () => Pick<NotesService, 'getNote' | 'listNotes' | 'listProjectSummaries' | 'listNoteHistory' | 'getNoteSnapshot' | 'createAiEditPatch'>): void {
  const policy = { majorVersion: 1, effect: 'read' as const, surfaces: ['http', 'agent', 'cli'] as const, scopes: ['workspace.read'] as const };
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.notes.preview_edit', description: 'Build a local edit suggestion without modifying the note or calling a model.',
    ...ProductReadContracts['xopc.notes.preview_edit'],
    async execute({ id, instruction, markdown }) {
      const result = await getNotes().createAiEditPatch(id, instruction, markdown);
      if (!result) throw new CapabilityError('NOT_FOUND', 'Note not found');
      return ProductReadContracts['xopc.notes.preview_edit'].output.parse(result);
    },
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.notes.project_summaries', description: 'List project note counts without rebuilding understanding.',
    ...ProductReadContracts['xopc.notes.project_summaries'],
    execute: () => ({ items: getNotes().listProjectSummaries() }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.notes.history', description: 'List immutable note history snapshots.',
    ...ProductReadContracts['xopc.notes.history'],
    execute: async ({ id }) => ({ entries: await getNotes().listNoteHistory(id) }),
  }));
  dispatcher.register(defineReadCapability({
    ...policy, id: 'xopc.notes.snapshot', description: 'Read one note snapshot at an exact timestamp.',
    ...ProductReadContracts['xopc.notes.snapshot'],
    async execute({ id, timestamp }) {
      const snapshot = await getNotes().getNoteSnapshot(id, timestamp);
      if (!snapshot) throw new CapabilityError('NOT_FOUND', 'Snapshot not found');
      return { snapshot };
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.notes.get', majorVersion: 1, description: 'Read a note by its stable ID.',
    effect: 'read', surfaces: ['http', 'agent', 'cli', 'extension'], scopes: ['workspace.read'],
    ...ProductReadContracts['xopc.notes.get'],
    async execute({ id }) {
      const note = await getNotes().getNote(id);
      if (!note) throw new CapabilityError('NOT_FOUND', `Note not found: ${id}`);
      return { note: { ...note } };
    },
  }));
  dispatcher.register(defineReadCapability({
    id: 'xopc.notes.list', majorVersion: 1, description: 'List notes using explicit filters and pagination.',
    effect: 'read', surfaces: ['http', 'agent', 'cli', 'extension'], scopes: ['workspace.read'],
    ...ProductReadContracts['xopc.notes.list'],
    async execute(input) {
      const result = await getNotes().listNotes(input);
      return { ...result, items: result.items.map(item => ({ ...item })) };
    },
  }));
}
