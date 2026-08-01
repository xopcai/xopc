import { describe, expect, it } from 'vitest';

import {
  collectAssistantToolMedia,
  collectAssistantWorkspaceOutputPaths,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
} from '@/features/chat/messages/assistant-message-artifacts';
import type { MessageContent } from '@/features/chat/messages/messages.types';

describe('collectAssistantToolMedia', () => {
  it('reads media from the live tool_end result envelope', () => {
    const content: MessageContent[] = [{
      type: 'tool_use',
      id: 'image-1',
      name: 'image_generate',
      status: 'done',
      result: JSON.stringify({
        content: [{ type: 'text', text: 'Generated and attached 1 image.' }],
        details: {
          media: [{
            id: 'cat---id.webp',
            bucket: 'outbound',
            type: 'photo',
            mimeType: 'image/webp',
            name: 'cat.webp',
            size: 120,
            uri: 'media://outbound/cat---id.webp',
            path: '/state/media/outbound/cat---id.webp',
          }],
        },
      }),
    }];

    expect(collectAssistantToolMedia(content)).toEqual([
      expect.objectContaining({
        type: 'image',
        mimeType: 'image/webp',
        uri: 'media://outbound/cat---id.webp',
      }),
    ]);
  });
});

describe('collectAssistantWorkspaceOutputPaths', () => {
  it('merges absolute paths from write_file tool text', () => {
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'c1',
        name: 'write_file',
        input: { path: 'notes.txt' },
        status: 'done',
        result: 'File written: /Users/x/project/notes.txt',
      },
    ];
    const paths = collectAssistantWorkspaceOutputPaths(content);
    expect(paths).toEqual([
      expect.objectContaining({
        fileName: 'notes.txt',
        absolutePath: '/Users/x/project/notes.txt',
        mimeType: 'text/plain',
      }),
    ]);
  });

  it('skips read_file and other non-writer tools', () => {
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'a',
        name: 'read_file',
        input: { path: 'a.txt' },
        status: 'done',
        result: 'content of /Users/x/ws/a.txt',
      },
      {
        type: 'tool_use',
        id: 'b',
        name: 'list_dir',
        input: { path: '.' },
        status: 'done',
        result: 'f a.txt',
      },
    ];
    expect(collectAssistantWorkspaceOutputPaths(content)).toEqual([]);
  });

  it('does not collect assistant markdown paths without a writer tool in the same turn', () => {
    const content: MessageContent[] = [
      {
        type: 'text',
        text: '- **`guide.html`**\n- **`IDENTITY.md`**',
      },
    ];
    expect(collectAssistantWorkspaceOutputPaths(content)).toEqual([]);
  });

  it('keeps absolute writer path even when a bare assistant-markdown mention names the same file', () => {
    // Bare-name mention (`hangzhou-trip.html`) no longer cross-links via basename
    // (option A — prevents same-name false positives across writer outputs). The
    // file still surfaces because the writer's tool-result entry already carries
    // the absolute path.
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'w1',
        name: 'write_file',
        input: { path: 'hangzhou-trip.html' },
        status: 'done',
        result: 'File written: /Users/x/ws/hangzhou-trip.html',
      },
      {
        type: 'text',
        text: 'Done. **`hangzhou-trip.html`**',
      },
    ];
    const paths = collectAssistantWorkspaceOutputPaths(content);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.absolutePath).toBe('/Users/x/ws/hangzhou-trip.html');
    expect(paths[0]?.workspaceRelativePath).toBeUndefined();
  });

  it('cross-links a path-shaped assistant mention to a tool-result absolute path (option A)', () => {
    // Same artifact, mention has at least one "/" so the basename cross-link kicks in.
    // The combining merge preserves the real absolute path AND attaches the rel for
    // remote-friendly resolve, so the chip can fall back to the abs if rel misses.
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'w1',
        name: 'write_file',
        input: { path: 'acp-demo/index.html' },
        status: 'done',
        result: 'File written: /Users/x/develop/acp-demo/index.html',
      },
      {
        type: 'text',
        text: '直接用浏览器打开 **`acp-demo/index.html`** 即可预览。',
      },
    ];
    const paths = collectAssistantWorkspaceOutputPaths(content);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.absolutePath).toBe('/Users/x/develop/acp-demo/index.html');
    expect(paths[0]?.workspaceRelativePath).toBe('acp-demo/index.html');
  });

  it('filterAssistantAttachmentsDedupedAgainstWorkspacePaths removes duplicate document chips', () => {
    const paths = collectAssistantWorkspaceOutputPaths([
      {
        type: 'tool_use',
        id: 'w1',
        name: 'write_file',
        input: { path: 'hangzhou-trip.html' },
        status: 'done',
        result: 'File written: /Users/x/ws/hangzhou-trip.html',
      },
      {
        type: 'text',
        text: '**`hangzhou-trip.html`**',
      },
    ]);
    const next = filterAssistantAttachmentsDedupedAgainstWorkspacePaths(
      [{ name: 'hangzhou-trip.html', mimeType: 'text/html', type: 'file' }],
      paths,
    );
    expect(next).toBeUndefined();
  });

  it('skips failed or running tools', () => {
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: '1',
        name: 'write_file',
        input: { path: 'a.txt' },
        status: 'error',
        result: 'nope',
      },
      {
        type: 'tool_use',
        id: '2',
        name: 'write_file',
        input: { path: 'b.txt' },
        status: 'running',
        result: undefined,
      },
    ];
    expect(collectAssistantWorkspaceOutputPaths(content)).toEqual([]);
  });
});
