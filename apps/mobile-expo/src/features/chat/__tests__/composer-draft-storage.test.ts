import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();

vi.mock('../../../storage/mmkv', () => ({
  storage: {
    getString: (key: string) => memory.get(key),
    set: (key: string, value: string) => {
      memory.set(key, String(value));
    },
    delete: (key: string) => {
      memory.delete(key);
    },
  },
}));

import {
  clearComposerDraftSnapshot,
  readComposerDraftSnapshot,
  writeComposerDraftSnapshot,
} from '../composer-draft-storage';

describe('composer-draft-storage', () => {
  beforeEach(() => {
    memory.clear();
  });

  it('roundtrips draft text and cursor position per session', () => {
    writeComposerDraftSnapshot('session-a', { text: 'hello mobile', cursorPos: 5 });

    expect(readComposerDraftSnapshot('session-a')).toEqual({
      text: 'hello mobile',
      cursorPos: 5,
      contextRefs: [],
    });
  });

  it('isolates drafts by session key', () => {
    writeComposerDraftSnapshot('a', { text: 'draft a', cursorPos: 1 });
    writeComposerDraftSnapshot('b', { text: 'draft b', cursorPos: 2 });

    expect(readComposerDraftSnapshot('a')?.text).toBe('draft a');
    expect(readComposerDraftSnapshot('b')?.text).toBe('draft b');
  });

  it('clears empty drafts instead of persisting whitespace', () => {
    writeComposerDraftSnapshot('x', { text: 'draft', cursorPos: 3 });
    writeComposerDraftSnapshot('x', { text: '   ', cursorPos: 2 });

    expect(readComposerDraftSnapshot('x')).toBeNull();
  });

  it('clamps cursor position into the text range', () => {
    writeComposerDraftSnapshot('x', { text: 'abc', cursorPos: 99 });

    expect(readComposerDraftSnapshot('x')).toEqual({ text: 'abc', cursorPos: 3, contextRefs: [] });
  });

  it('persists note-only draft context with a frozen version', () => {
    writeComposerDraftSnapshot('note', {
      text: '',
      cursorPos: 0,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: '42', title: 'Plan' }],
    });

    expect(readComposerDraftSnapshot('note')?.contextRefs).toEqual([
      { kind: 'note', sourceId: 'note-1', expectedVersion: '42', title: 'Plan' },
    ]);
  });

  it('clearComposerDraftSnapshot removes persisted draft', () => {
    writeComposerDraftSnapshot('z', { text: 'draft', cursorPos: 1 });
    clearComposerDraftSnapshot('z');

    expect(readComposerDraftSnapshot('z')).toBeNull();
  });
});

it('restores task references with their selected version', () => {
  writeComposerDraftSnapshot('task-reference', {
    text: '', cursorPos: 0,
    contextRefs: [{ kind: 'task', sourceId: 'task-1', expectedVersion: '7', title: 'Launch' }],
  });
  expect(readComposerDraftSnapshot('task-reference')?.contextRefs).toEqual([
    { kind: 'task', sourceId: 'task-1', expectedVersion: '7', title: 'Launch' },
  ]);
});

it('restores workspace files even without message text', () => {
  const file = { id: 'file-1', type: 'document' as const, name: 'Plan', mimeType: 'text/plain', size: 12, content: '', workspaceRelativePath: 'plan.txt' };
  writeComposerDraftSnapshot('file-reference', { text: '', cursorPos: 0, workspaceFiles: [file] });
  expect(readComposerDraftSnapshot('file-reference')?.workspaceFiles).toEqual([file]);
});
