import { describe, it, expect } from 'vitest';
import { resolveSafeInboundFilePath, formatInboundFileTextBlock } from '../inbound-persist.js';

describe('inbound-persist', () => {
  const ws = '/home/user/ws';

  it('resolveSafeInboundFilePath rejects traversal and non-inbound paths', () => {
    expect(resolveSafeInboundFilePath(ws, '.xopcbot/inbound/s/doc.txt')).toBeTruthy();
    expect(resolveSafeInboundFilePath(ws, '../.xopcbot/inbound/s/doc.txt')).toBeNull();
    expect(resolveSafeInboundFilePath(ws, 'other/file.txt')).toBeNull();
    expect(resolveSafeInboundFilePath(ws, '.xopcbot/other/file.txt')).toBeNull();
  });

  it('formatInboundFileTextBlock includes abs path when persisted', () => {
    const text = formatInboundFileTextBlock(
      {
        type: 'document',
        mimeType: 'text/plain',
        name: 'a.md',
        size: 10,
        workspaceRelativePath: '.xopcbot/inbound/k/a.md',
      },
      ws,
    );
    expect(text).toContain('[File: a.md (text/plain, 10 bytes)]');
    expect(text).toContain('xopcbot-path:rel:.xopcbot/inbound/k/a.md');
    expect(text).toContain('xopcbot-path:abs:');
  });
});
