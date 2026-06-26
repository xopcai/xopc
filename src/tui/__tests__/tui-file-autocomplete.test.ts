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

  it('merges dynamic skill slash commands into slash completion', async () => {
    const primary = {
      async getSuggestions() {
        return null;
      },
      applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
        return { lines, cursorLine, cursorCol };
      },
    };
    const skillCommands = [
      { name: 'skill:review', description: 'Apply skill to the next turn' },
    ];
    const provider = new ChainedAutocompleteProvider(
      primary,
      [],
      [],
      new Set(),
      () => 'agent:main:main',
      '/repo',
      skillCommands,
    );

    const first = await provider.getSuggestions(['/skill:r'], 0, '/skill:r'.length, {
      signal: new AbortController().signal,
    });
    expect(first?.items.map((item) => item.value)).toEqual(['/skill:review']);

    skillCommands.splice(0, skillCommands.length, {
      name: 'skill:tdd',
      description: 'Apply skill to the next turn',
    });
    const second = await provider.getSuggestions(['/skill:t'], 0, '/skill:t'.length, {
      signal: new AbortController().signal,
    });
    expect(second?.items.map((item) => item.value)).toEqual(['/skill:tdd']);
  });

  it('applies slash command completions without duplicating the slash prefix', () => {
    const primary = {
      async getSuggestions() {
        return null;
      },
      applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
        return { lines, cursorLine, cursorCol };
      },
    };
    const provider = new ChainedAutocompleteProvider(
      primary,
      [],
      [],
      new Set(),
      () => 'agent:main:main',
      '/repo',
      [{ name: 'skill:diagnose', description: 'Apply skill to the next turn' }],
    );

    const applied = provider.applyCompletion(
      ['/skill:d'],
      0,
      '/skill:d'.length,
      { value: '/skill:diagnose', label: 'skill:diagnose' },
      '/skill:d',
    );

    expect(applied.lines).toEqual(['/skill:diagnose']);
    expect(applied.cursorCol).toBe('/skill:diagnose'.length);
  });

  it('merges dynamic workflow slash commands into slash completion', async () => {
    const primary = {
      async getSuggestions() {
        return null;
      },
      applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
        return { lines, cursorLine, cursorCol };
      },
    };
    const provider = new ChainedAutocompleteProvider(
      primary,
      [],
      [],
      new Set(),
      () => 'agent:main:main',
      '/repo',
      [
        { name: 'workflow:audit_repo', description: 'Run workflow' },
        { name: 'workflow:weekly_review', description: 'Run workflow' },
      ],
    );

    const suggestions = await provider.getSuggestions(['/workflow:a'], 0, '/workflow:a'.length, {
      signal: new AbortController().signal,
    });

    expect(suggestions?.items.map((item) => item.value)).toEqual(['/workflow:audit_repo']);
  });
});
