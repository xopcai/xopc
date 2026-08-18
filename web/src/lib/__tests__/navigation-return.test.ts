import { describe, expect, it } from 'vitest';

import { safeInternalReturnPath, withReturnTo } from '../navigation-return';

describe('navigation return paths', () => {
  it('accepts only the configured internal route families', () => {
    expect(safeInternalReturnPath('/chat/session-1', '/projects', ['/chat'])).toBe('/chat/session-1');
    expect(safeInternalReturnPath('/projects/p-1/work-items?returnTo=%2Fchat%2Fs-1', '/work', ['/projects', '/chat']))
      .toBe('/projects/p-1/work-items?returnTo=%2Fchat%2Fs-1');
    expect(safeInternalReturnPath('/projects-old/p-1', '/work', ['/projects'])).toBe('/work');
  });

  it('rejects external, protocol-relative, and backslash paths', () => {
    expect(safeInternalReturnPath('https://example.com', '/projects', ['/chat'])).toBe('/projects');
    expect(safeInternalReturnPath('//example.com/chat/1', '/projects', ['/chat'])).toBe('/projects');
    expect(safeInternalReturnPath('/chat\\example', '/projects', ['/chat'])).toBe('/projects');
  });

  it('appends an encoded return path while preserving query and hash segments', () => {
    expect(withReturnTo('/work/g-1', '/chat/s-1')).toBe('/work/g-1?returnTo=%2Fchat%2Fs-1');
    expect(withReturnTo('/workflows?run=r-1#result', '/chat/s-1'))
      .toBe('/workflows?run=r-1&returnTo=%2Fchat%2Fs-1#result');
  });
});
