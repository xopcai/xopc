import { describe, it, expect } from 'vitest';
import { createTodoTool } from '../todo-tool.js';

describe('todo tool', () => {
  it('returns empty list initially', async () => {
    const tool = createTodoTool();
    const result = await tool.execute('test-1', {});
    expect(result.details?.items).toEqual([]);
    expect((result.content[0] as { type: string; text: string }).text).toContain('No todos');
  });

  it('hydrates and persists through an injected repository', async () => {
    const persisted = new Map<string, Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>>([
      ['session-a', [{ id: 'existing', content: 'Existing', status: 'pending' }]],
    ]);
    const tool = createTodoTool({
      getSessionKey: () => 'session-a',
      repository: {
        read: (sessionKey) => persisted.get(sessionKey) ?? [],
        write: (sessionKey, items) => persisted.set(sessionKey, items),
      },
    });

    const read = await tool.execute('read', {}, undefined);
    expect(read.details).toEqual({
      items: [{ id: 'existing', content: 'Existing', status: 'pending' }],
    });

    await tool.execute('write', {
      todos: [{ id: 'existing', content: 'Existing', status: 'completed' }],
      merge: true,
    }, undefined);
    expect(persisted.get('session-a')).toEqual([
      { id: 'existing', content: 'Existing', status: 'completed' },
    ]);
  });

  it('falls back to in-memory state while the repository is unavailable', async () => {
    const tool = createTodoTool({
      getSessionKey: () => 'session-a',
      repository: {
        isAvailable: () => false,
        read: () => { throw new Error('must not read'); },
        write: () => { throw new Error('must not write'); },
      },
    });

    await tool.execute('write', {
      todos: [{ id: 'local', content: 'Local', status: 'pending' }],
    });
    expect((await tool.execute('read', {})).details).toEqual({
      items: [{ id: 'local', content: 'Local', status: 'pending' }],
    });
  });

  it('writes and reads todos', async () => {
    const tool = createTodoTool();
    const writeResult = await tool.execute('test-2', {
      todos: [
        { id: '1', content: 'First task', status: 'pending' },
        { id: '2', content: 'Second task', status: 'in_progress' },
      ],
    });
    expect(writeResult.details?.items).toHaveLength(2);

    const readResult = await tool.execute('test-3', {});
    expect(readResult.details?.items).toHaveLength(2);
  });

  it('merges by id', async () => {
    const tool = createTodoTool();
    await tool.execute('test-4', {
      todos: [
        { id: '1', content: 'Task A', status: 'pending' },
        { id: '2', content: 'Task B', status: 'pending' },
      ],
    });

    const result = await tool.execute('test-5', {
      todos: [{ id: '1', content: 'Task A', status: 'completed' }],
      merge: true,
    });

    expect(result.details?.items?.[0]?.status).toBe('completed');
    expect(result.details?.items?.[1]?.status).toBe('pending');
  });

  it('returns error text for invalid item in replace mode', async () => {
    const tool = createTodoTool();
    const result = await tool.execute('test-6', {
      todos: [{ id: '', content: 'No ID', status: 'pending' }],
    });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('Error');
  });

  it('clears list when replace with empty array', async () => {
    const tool = createTodoTool();
    await tool.execute('a', {
      todos: [{ id: '1', content: 'x', status: 'pending' }],
    });
    await tool.execute('b', { todos: [] });
    const r = await tool.execute('c', {});
    expect(r.details?.items).toEqual([]);
  });

  it('isolates stores per session key', async () => {
    let session = 's1';
    const tool = createTodoTool({ getSessionKey: () => session });

    await tool.execute('1', { todos: [{ id: 'a', content: 'A', status: 'pending' }] });
    session = 's2';
    await tool.execute('2', { todos: [{ id: 'b', content: 'B', status: 'pending' }] });

    session = 's1';
    const r1 = await tool.execute('3', {});
    session = 's2';
    const r2 = await tool.execute('4', {});

    expect(r1.details?.items).toHaveLength(1);
    expect(r1.details?.items?.[0]?.id).toBe('a');
    expect(r2.details?.items).toHaveLength(1);
    expect(r2.details?.items?.[0]?.id).toBe('b');
  });

  it('defaults unknown status to pending for new items', async () => {
    const tool = createTodoTool();
    const result = await tool.execute('u', {
      todos: [{ id: '1', content: 'x', status: 'bogus' as 'pending' }],
    });
    expect(result.details?.items?.[0]?.status).toBe('pending');
  });
});
