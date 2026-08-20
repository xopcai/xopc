import { describe, expect, it } from 'vitest';

import { safeInternalReturnPath, withDetailReturnTo, withReturnTo } from '../navigation-return';

describe('navigation return paths', () => {
  it('accepts only the configured internal route families', () => {
    expect(safeInternalReturnPath('/chat/session-1', '/projects', ['/chat'])).toBe('/chat/session-1');
    expect(safeInternalReturnPath('/projects/p-1/workflows?returnTo=%2Fchat%2Fs-1', '/', ['/projects', '/chat']))
      .toBe('/projects/p-1/workflows?returnTo=%2Fchat%2Fs-1');
    expect(safeInternalReturnPath('/projects-old/p-1', '/', ['/projects'])).toBe('/');
  });

  it('rejects external, protocol-relative, and backslash paths', () => {
    expect(safeInternalReturnPath('https://example.com', '/projects', ['/chat'])).toBe('/projects');
    expect(safeInternalReturnPath('//example.com/chat/1', '/projects', ['/chat'])).toBe('/projects');
    expect(safeInternalReturnPath('/chat\\example', '/projects', ['/chat'])).toBe('/projects');
  });

  it('appends an encoded return path while preserving query and hash segments', () => {
    expect(withReturnTo('/tasks/g-1', '/chat/s-1')).toBe('/tasks/g-1?returnTo=%2Fchat%2Fs-1');
    expect(withReturnTo('/workflows?run=r-1#result', '/chat/s-1'))
      .toBe('/workflows?run=r-1&returnTo=%2Fchat%2Fs-1#result');
  });

  it('preserves a project task-board origin', () => {
    const href = withReturnTo('/tasks/task-1', '/projects/project-1/tasks');
    expect(href).toBe('/tasks/task-1?returnTo=%2Fprojects%2Fproject-1%2Ftasks');
    expect(safeInternalReturnPath(
      new URLSearchParams(href.split('?')[1]).get('returnTo'),
      '/',
      ['/projects'],
    )).toBe('/projects/project-1/tasks');
  });

  it('adds a chat origin only to supported detail routes', () => {
    expect(withDetailReturnTo('/notes/note-1', '/chat/session-1?view=full'))
      .toBe('/notes/note-1?returnTo=%2Fchat%2Fsession-1%3Fview%3Dfull');
    expect(withDetailReturnTo('/settings/appearance', '/chat/session-1'))
      .toBe('/settings/appearance');
    expect(withDetailReturnTo('/notes/note-1?returnTo=%2Fprojects%2Fp-1%2Fnotes', '/chat/session-1'))
      .toBe('/notes/note-1?returnTo=%2Fprojects%2Fp-1%2Fnotes');
  });

  it('rejects external and unsupported return targets', () => {
    expect(safeInternalReturnPath('https://example.com', '/notes', ['/chat'])).toBe('/notes');
    expect(safeInternalReturnPath('//example.com', '/notes', ['/chat'])).toBe('/notes');
    expect(safeInternalReturnPath('/settings/security', '/notes', ['/chat'])).toBe('/notes');
  });
});
