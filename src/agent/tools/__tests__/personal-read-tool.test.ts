import { describe, expect, it, vi } from 'vitest';

import { createPersonalReadTool } from '../personal-read-tool.js';

function setup(authorizeCapability?: () => boolean) {
  const note = { id: 'note-1', markdown: 'x'.repeat(50000), title: 'Title', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 2 };
  const notes = { getNote: vi.fn(async () => note), listNotes: vi.fn(async () => ({ items: [note], total: 1 })) };
  return { notes, tool: createPersonalReadTool({ getNotesService: () => notes as never, authorizeCapability }) };
}

describe('personal_read', () => {
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
