import { describe, expect, it } from 'vitest';

import { chatRoute, noteDetailRoute } from '../navigation-routes';

describe('noteDetailRoute', () => {
  it('passes draft ids as route params instead of interpolating them into the path', () => {
    expect(noteDetailRoute('draft:1710000000000_abcd1234')).toEqual({
      pathname: '/items/[id]',
      params: { id: 'draft:1710000000000_abcd1234' },
    });
  });

  it('keeps optional highlight params with the note id', () => {
    expect(noteDetailRoute('note-1', { heading: '  Heading  ', range: { start: 3, end: 8 } })).toEqual({
      pathname: '/items/[id]',
      params: {
        id: 'note-1',
        heading: 'Heading',
        start: '3',
        end: '8',
      },
    });
  });
});

describe('chatRoute', () => {
  it('keeps task context as an explicit route parameter', () => {
    expect(chatRoute('agent:a:webchat:task', { taskId: 'task/1' })).toEqual({
      pathname: '/chat/[k]',
      params: { k: 'agent:a:webchat:task', taskId: 'task/1' },
    });
  });
});
