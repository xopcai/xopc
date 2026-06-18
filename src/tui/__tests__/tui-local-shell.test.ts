import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { createLocalShellRunner, formatLocalShellConsentHint } from '../tui-local-shell.js';

describe('local shell prompt hints', () => {
  it('uses resolved select keybindings in the consent prompt', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.confirm': 'x',
      'tui.select.cancel': 'z',
    });

    expect(formatLocalShellConsentHint(keybindings)).toBe('↑/↓ + X to choose, Z to cancel.');
  });

  it('keeps the default hint when no keybindings manager is provided', () => {
    expect(formatLocalShellConsentHint()).toBe('↑/↓ + Enter to choose, Esc to cancel.');
  });

  it('reports captured local shell output after ! command completion', async () => {
    let overlay: { onSelect?: (item: { value: string }) => void } | undefined;
    const completions: unknown[] = [];
    const outputChunks: string[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let markSpawned: (() => void) | undefined;
    const spawned = new Promise<void>((resolve) => {
      markSpawned = resolve;
    });

    const { runLocalShellLine } = createLocalShellRunner({
      chatLog: {
        addSystem: () => {},
        addBashExecution: () => ({
          appendOutput: (chunk: string) => outputChunks.push(chunk),
          setComplete: () => {},
          setError: () => {},
          setExpanded: () => {},
          render: () => [],
          invalidate: () => {},
        }),
      },
      tui: {
        requestRender: () => {},
        setFocus: () => {},
      } as never,
      editor: {} as never,
      openOverlay: (component) => {
        overlay = component as typeof overlay;
      },
      closeOverlay: () => {},
      spawnCommand: () => {
        markSpawned?.();
        return child as never;
      },
      maxOutputChars: 5,
      onComplete: (entry) => completions.push(entry),
    });

    const run = runLocalShellLine('!printf abcdef');
    expect(overlay).toBeDefined();
    overlay?.onSelect?.({ value: 'yes' });
    await spawned;
    child.stdout.emit('data', Buffer.from('abcdef'));
    child.emit('close', 0, null);
    await run;

    expect(outputChunks).toEqual(['abcde']);
    expect(completions).toEqual([
      {
        command: 'printf abcdef',
        output: 'abcde',
        exitCode: 0,
        signal: null,
        excludeFromContext: false,
        truncated: true,
      },
    ]);
  });

  it('waits for transcript persistence before marking ! command complete', async () => {
    let overlay: { onSelect?: (item: { value: string }) => void } | undefined;
    const events: string[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let releasePersist!: () => void;
    const persistDone = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    let markSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => {
      markSpawned = resolve;
    });

    const { runLocalShellLine } = createLocalShellRunner({
      chatLog: {
        addSystem: () => {},
        addBashExecution: () => ({
          appendOutput: () => {},
          setComplete: () => events.push('complete'),
          setError: () => events.push('error'),
          setExpanded: () => {},
          render: () => [],
          invalidate: () => {},
        }),
      },
      tui: {
        requestRender: () => {},
        setFocus: () => {},
      } as never,
      editor: {} as never,
      openOverlay: (component) => {
        overlay = component as typeof overlay;
      },
      closeOverlay: () => {},
      spawnCommand: () => {
        markSpawned();
        return child as never;
      },
      onComplete: async () => {
        events.push('persist:start');
        await persistDone;
        events.push('persist:end');
      },
    });

    let resolved = false;
    const run = runLocalShellLine('!echo ok').then(() => {
      resolved = true;
    });
    overlay?.onSelect?.({ value: 'yes' });
    await spawned;
    child.emit('close', 0, null);
    await Promise.resolve();

    expect(events).toEqual(['persist:start']);
    expect(resolved).toBe(false);

    releasePersist();
    await run;

    expect(events).toEqual(['persist:start', 'persist:end', 'complete']);
    expect(resolved).toBe(true);
  });
});
