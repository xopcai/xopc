import { describe, it, expect } from 'vitest';
import {
  resolveSafeInboundFilePath,
  formatInboundFileTextBlock,
  stripInboundFileMetadataFromText,
} from '../inbound-persist.js';

describe('inbound-persist', () => {
  const agentHome = '/home/user/.xopcbot/agents/main';
  const roots = { agentHome };

  it('resolveSafeInboundFilePath rejects traversal and non-inbound paths', () => {
    expect(resolveSafeInboundFilePath(roots, 'inbound/s/doc.txt')).toBeTruthy();
    expect(resolveSafeInboundFilePath(roots, '../inbound/s/doc.txt')).toBeNull();
    expect(resolveSafeInboundFilePath(roots, 'other/file.txt')).toBeNull();
    expect(resolveSafeInboundFilePath(roots, '.xopcbot/inbound/s/doc.txt')).toBeNull();
  });

  it('formatInboundFileTextBlock includes abs path when persisted', () => {
    const text = formatInboundFileTextBlock(
      {
        type: 'document',
        mimeType: 'text/plain',
        name: 'a.md',
        size: 10,
        workspaceRelativePath: 'inbound/k/a.md',
      },
      agentHome,
    );
    expect(text).toContain('[File: a.md (text/plain, 10 bytes)]');
    expect(text).toContain('xopcbot-path:rel:inbound/k/a.md');
    expect(text).toContain('xopcbot-path:abs:');
  });

  it('stripInboundFileMetadataFromText removes file blocks for session titles', () => {
    const block = formatInboundFileTextBlock(
      {
        type: 'document',
        mimeType: 'text/plain',
        name: 'design-system.md',
        size: 34298,
        workspaceRelativePath: 'inbound/k/f.md',
      },
      agentHome,
    );
    const joined = `分析 ${block}`;
    expect(stripInboundFileMetadataFromText(joined)).toBe('分析');
  });
});
