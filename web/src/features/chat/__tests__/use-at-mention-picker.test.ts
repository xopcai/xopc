import { describe, it, expect } from 'vitest';

import { detectAtRange, escapeAtQuery } from '@/features/chat/palette/use-at-mention-picker';
import { contextRefFromAtMentionItem } from '@/features/chat/composer/use-composer-pickers';

describe('detectAtRange', () => {
  it('returns range and query after @', () => {
    const text = 'hello @sche world';
    const cursor = 'hello @sche'.length;
    expect(detectAtRange(text, cursor)).toEqual({ start: 6, end: 11, query: 'sche' });
  });

  it('ignores @ inside email local-part but still detects a later @ mention', () => {
    const text = 'user@domain.com @ok';
    const cursor = text.length;
    expect(detectAtRange(text, cursor)).toEqual({ start: 16, end: text.length, query: 'ok' });
    const atDomain = 'a@b';
    expect(detectAtRange(atDomain, atDomain.length)).toBeNull();
  });

  it('returns null when no @ before caret', () => {
    expect(detectAtRange('plain', 5)).toBeNull();
  });

  it('keeps directory browsing active when a path contains spaces', () => {
    const text = 'see @My\\ Folder/';
    expect(detectAtRange(text, text.length)).toEqual({
      start: 4,
      end: text.length,
      query: 'My Folder/',
    });
    expect(escapeAtQuery('My Folder/nested')).toBe('My\\ Folder/nested');
  });
});

describe('@ mention context references', () => {
  it('maps a Note item to a frozen composer context reference', () => {
    expect(contextRefFromAtMentionItem({
      id: 'note:note-1',
      kind: 'note',
      name: 'Launch plan',
      description: 'Plan snapshot',
      noteRef: { sourceId: 'note-1', expectedVersion: '42' },
    })).toEqual(expect.objectContaining({
      refId: expect.any(String),
      kind: 'note',
      sourceId: 'note-1',
      expectedVersion: '42',
      title: 'Launch plan',
    }));
  });

  it('maps a file item to a frozen composer context reference', () => {
    expect(contextRefFromAtMentionItem({
      id: 'file:file-1',
      kind: 'file',
      name: 'README.md',
      description: 'README.md',
      relativePath: 'README.md',
      isDirectory: false,
      fileRef: { sourceId: 'file-1', expectedVersion: '7' },
    })).toEqual(expect.objectContaining({
      refId: expect.any(String),
      kind: 'file',
      sourceId: 'file-1',
      expectedVersion: '7',
      title: 'README.md',
      fileKind: 'file',
    }));
  });

  it('turns a selected directory into a frozen context reference', () => {
    expect(contextRefFromAtMentionItem({
      id: 'file:dir-1',
      kind: 'file',
      name: 'src',
      description: 'src',
      relativePath: 'src',
      isDirectory: true,
      fileRef: { sourceId: 'dir-1', expectedVersion: '7' },
    })).toEqual(expect.objectContaining({
      refId: expect.any(String),
      kind: 'file',
      sourceId: 'dir-1',
      expectedVersion: '7',
      title: 'src',
      fileKind: 'directory',
    }));
  });

  it('keeps the synthetic browse-up row as navigation only', () => {
    expect(contextRefFromAtMentionItem({
      id: 'browse-up:src',
      kind: 'file',
      name: '..',
      description: '/',
      relativePath: '',
      isDirectory: true,
      isBrowseUp: true,
    })).toBeNull();
  });

  it('maps browser tabs and MCP resources without serializing magic text tokens', () => {
    expect(contextRefFromAtMentionItem({
      id: 'browser-tab:binding-1', kind: 'browser_tab', name: 'Example',
      description: 'https://example.com', url: 'https://example.com',
      tabRef: { sourceId: 'binding-1', expectedVersion: 'doc-1' },
    })).toEqual(expect.objectContaining({
      refId: expect.any(String),
      kind: 'browser_tab', sourceId: 'binding-1', expectedVersion: 'doc-1', title: 'Example',
    }));
    expect(contextRefFromAtMentionItem({
      id: 'mcp-resource:resource-1', kind: 'mcp_resource', name: 'Launch brief',
      description: 'docs', serverId: 'docs', uri: 'file:///launch.md',
      resourceRef: { sourceId: 'resource-1', expectedVersion: 'rev-1' },
    })).toEqual(expect.objectContaining({
      refId: expect.any(String),
      kind: 'mcp_resource', sourceId: 'resource-1', expectedVersion: 'rev-1', title: 'Launch brief',
    }));
  });
});
