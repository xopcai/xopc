import { describe, expect, it } from 'vitest';

import {
  collectAssistantWorkspaceOutputPaths,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
} from '@/features/chat/assistant-message-artifacts';
import type { MessageContent } from '@/features/chat/messages.types';

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

  it('dedupes write_file absolute path against the same file in assistant markdown', () => {
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
    expect(paths[0]?.workspaceRelativePath).toBe('hangzhou-trip.html');
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
