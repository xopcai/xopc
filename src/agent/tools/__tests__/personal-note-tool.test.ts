import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { NotesService } from '../../../notes/service.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { createPersonalNoteTool } from '../personal-note-tool.js';

describe('personal_note tool', () => {
  let dir: string;
  let conversationId: string;
  let notesService: NotesService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-personal-note-tool-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('XOPC_LOG_FILE', 'false');
    resetXopcDatabaseSingletonForTest();
    initializeTestAgentCatalog({ agents: [{ id: personalAgentId('local-owner') }] });
    conversationId = createConversation({
      agentId: personalAgentId('local-owner'),
      customData: { personalAgent: true },
    }).key;
    notesService = new NotesService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects non-personal conversations', async () => {
    const ordinary = createConversation({ agentId: 'main' }).key;
    const tool = createPersonalNoteTool({
      getCurrentConversationId: () => ordinary,
      getNotesService: () => notesService,
    });
    const result = await tool.execute('call-0', {
      command: 'create',
      title: 'Blocked',
      markdown: 'Should not save',
    });
    expect(result.details.ok).toBe(false);
  });

  it('creates, appends, and updates notes directly', async () => {
    const tool = createPersonalNoteTool({
      getCurrentConversationId: () => conversationId,
      getNotesService: () => notesService,
    });

    const created = await tool.execute('call-1', {
      command: 'create',
      title: 'Meeting Memo',
      markdown: '- Discussed Q4 roadmap',
      tags: ['work'],
    });
    expect(created.details.ok).toBe(true);
    const createdNote = created.details.note as { id: string; title: string; updatedAt: number };
    expect(createdNote.id).toBeTruthy();
    expect(createdNote.title).toBe('Meeting Memo');

    const appended = await tool.execute('call-2', {
      command: 'append',
      noteId: createdNote.id,
      heading: 'Action Items',
      content: '- Follow up with design team',
    });
    expect(appended.details.ok).toBe(true);
    const afterAppend = await notesService.getNote(createdNote.id);
    expect(afterAppend?.markdown).toContain('Action Items');
    expect(afterAppend?.markdown).toContain('Follow up with design team');

    const updated = await tool.execute('call-3', {
      command: 'update',
      noteId: createdNote.id,
      title: 'Q4 Meeting Memo',
      pinned: true,
    });
    expect(updated.details.ok).toBe(true);
    const afterUpdate = await notesService.getNote(createdNote.id);
    expect(afterUpdate?.title).toBe('Q4 Meeting Memo');
    expect(afterUpdate?.pinned).toBe(true);
  });
});
