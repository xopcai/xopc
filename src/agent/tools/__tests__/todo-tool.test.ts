import { describe, it, expect } from 'vitest';
import { createTodoTool } from '../todo-tool.js';

describe('todo tool', () => {
  it('returns empty list initially', async () => {
    const tool = createTodoTool();
    const result = await tool.execute('test-1', {});
    expect(result.details?.items).toEqual([]);
    expect((result.content[0] as { type: string; text: string }).text).toContain('No todos');
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
