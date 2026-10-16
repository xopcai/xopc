import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase } from '../../../storage/sqlite/index.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { runWithEmbeddedExecutionSession } from '../../embedded/execution-context.js';
import { createPersonalReadTool } from '../personal-read-tool.js';

let conversationId: string;
beforeEach(() => {
  initializeTestAgentCatalog({ agents: [{ id: personalAgentId('local-owner') }] });
  conversationId = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true } }).key;
});
afterEach(() => closeXopcDatabase());

function setup(authorizeCapability?: () => boolean) {
  const note = { id: 'note-1', markdown: 'x'.repeat(50000), title: 'Title', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 2 };
  const notes = { getNote: vi.fn(async () => note), listNotes: vi.fn(async () => ({ items: [note], total: 1 })) };
  return { notes, tool: createPersonalReadTool({ getCurrentConversationId: () => conversationId, getNotesService: () => notes as never, authorizeCapability }) };
}

describe('personal_read', () => {
  it('rejects absent, ordinary and embedded non-Personal identities before reading data', async () => {
    const { tool, notes } = setup();
    const ordinary = createConversation({ agentId: 'main' }).key;
    await runWithEmbeddedExecutionSession(ordinary, async () => {
      await expect(tool.execute('get', { kind: 'note', command: 'get', id: 'note-1' })).rejects.toThrow('Personal conversation');
    });
    for (const id of [undefined, ordinary]) {
      const restricted = createPersonalReadTool({ getCurrentConversationId: () => id, getNotesService: () => notes as never });
      await expect(restricted.execute('list', { kind: 'note', command: 'list' })).rejects.toThrow('Personal conversation');
    }
    expect(notes.getNote).not.toHaveBeenCalled();
    expect(notes.listNotes).not.toHaveBeenCalled();
  });

  it('shrinks JSON fields and list rows within the total budget while preserving IDs and cursors', async () => {
    const note = { id: 'note-1', title: '"\\\n'.repeat(6000), markdown: '"\\\n'.repeat(6000), description: 'x'.repeat(12000),
      kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 2 };
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...note, id: `note-${i + 1}` }));
    const tool = createPersonalReadTool({ getCurrentConversationId: () => conversationId, getNotesService: () => ({ getNote: async () => note,
      listNotes: async () => ({ items: rows, total: 30 }) }) as never });
    const get = await tool.execute('get', { kind: 'note', command: 'get', id: 'note-1' });
    const getText = (get.content[0] as { text: string }).text;
    expect(getText.length).toBeLessThanOrEqual(8000);
    expect(JSON.parse(getText)).toMatchObject({ id: 'note-1', requiresSpecialist: true, item: { id: 'note-1' } });
    const list = await tool.execute('list', { kind: 'note', command: 'list', offset: 5, limit: 10 });
    const listText = (list.content[0] as { text: string }).text;
    expect(listText.length).toBeLessThanOrEqual(8000);
    const payload = JSON.parse(listText);
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.length).toBeLessThan(10);
    expect(payload.nextOffset).toBe(5 + payload.items.length);
    expect(payload.items.at(-1).id).toBe(`note-${payload.items.length}`);
  });

  it('reads local note excerpts and passes bounded pagination to the service', async () => {
    const { tool, notes } = setup();
    const get = await tool.execute('get', { kind: 'note', command: 'get', id: 'note-1' });
    expect(get.details).toMatchObject({ requiresSpecialist: true });
    expect(JSON.parse((get.content[0] as { text: string }).text)).toMatchObject({ kind: 'note', id: 'note-1', requiresSpecialist: true });
    expect(JSON.parse((get.content[0] as { text: string }).text).item.markdown).toHaveLength(6000);
    const list = await tool.execute('list', { kind: 'note', command: 'list', limit: 100, offset: 5, search: 'Title' });
    expect(notes.listNotes).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 5, search: 'Title' }));
    expect(JSON.parse((list.content[0] as { text: string }).text).items[0].markdown).toHaveLength(200);
  });

  it('rejects writes and respects capability authorization', async () => {
    const { tool, notes } = setup(() => false);
    await expect(tool.execute('write', { kind: 'note', command: 'delete', id: 'note-1' })).rejects.toThrow('Only local');
    await expect(tool.execute('get', { kind: 'note', command: 'get', id: 'note-1' })).rejects.toThrow();
    expect(notes.getNote).not.toHaveBeenCalled();
  });
});
