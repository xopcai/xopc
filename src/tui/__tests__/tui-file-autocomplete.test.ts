import { describe, expect, it, vi } from 'vitest';

import { ChainedAutocompleteProvider } from '../extension-host/autocomplete.js';
import { createTuiFileAutocompleteProvider } from '../tui-file-autocomplete.js';

describe('TUI file autocomplete', () => {
  it('returns @file wire completions for workspace files', async () => {
    const search = vi.fn(async () => [
      { name: 'service.ts', path: 'src/agent/service.ts', isDirectory: false },
      { name: 'Meeting Notes.md', path: 'docs/Meeting Notes.md', isDirectory: false },
    ]);
    const provider = createTuiFileAutocompleteProvider(search);

    const suggestions = await provider('serv', { cwd: '/repo', sessionKey: 'agent:main:main' });

    expect(search).toHaveBeenCalledWith('agent:main:main', 'serv', { limit: 15 });
    expect(suggestions).toEqual([
      {
        name: 'src/agent/service.ts',
        value: '@file:src/agent/service.ts',
        label: 'service.ts',
        description: 'src/agent/service.ts',
      },
      {
        name: 'docs/Meeting Notes.md',
        value: '@file:"docs/Meeting Notes.md"',
        label: 'Meeting Notes.md',
        description: 'docs/Meeting Notes.md',
      },
    ]);
  });

  it('does not handle namespaced skill mentions', async () => {
    const search = vi.fn(async () => []);
    const provider = createTuiFileAutocompleteProvider(search);

    const suggestions = await provider('skill:review', { cwd: '/repo', sessionKey: 'agent:main:main' });

    expect(search).not.toHaveBeenCalled();
    expect(suggestions).toEqual([]);
  });

  it('keeps path-query file suggestions even when the basename does not match', async () => {
    const primary = {
      async getSuggestions() {
        return null;
      },
      applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
        return { lines, cursorLine, cursorCol };
      },
    };
    const fileProvider = createTuiFileAutocompleteProvider(async () => [
      { name: 'service.ts', path: 'src/agent/service.ts', isDirectory: false },
    ]);
    const provider = new ChainedAutocompleteProvider(
      primary,
      [fileProvider],
      [],
      new Set(),
      () => 'agent:main:main',
      '/repo',
    );

    const suggestions = await provider.getSuggestions(['@src/agent'], 0, '@src/agent'.length, {
      signal: new AbortController().signal,
    });

    expect(suggestions?.items.map((item) => item.value)).toEqual(['@file:src/agent/service.ts']);
  });
});
