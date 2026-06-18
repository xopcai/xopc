import { describe, expect, it, vi } from 'vitest';

import { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { createTuiExtensionRuntime } from '../extension-host/runtime.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';

describe('createTuiExtensionRuntime overlays and lifecycle', () => {
it('exposes async select, confirm, and input dialogs to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const results: unknown[] = [];
    let overlay: { handleInput?: (data: string) => void } | undefined;
    const opened: unknown[] = [];
    let closeCount = 0;

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('x', 'Dialog shortcut', async () => {
        results.push(await host.select('Pick color', ['red', 'green']));
        results.push(await host.confirm('Continue?', 'Run next step?'));
        results.push(await host.input('Name', 'enter name'));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component as typeof overlay;
        opened.push(component);
      },
      closeOverlay: () => {
        overlay = undefined;
        closeCount += 1;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('x')).toBe(true);

    await vi.waitFor(() => expect(opened).toHaveLength(1));
    overlay?.handleInput?.('\x1b[B');
    overlay?.handleInput?.('\r');

    await vi.waitFor(() => expect(opened).toHaveLength(2));
    overlay?.handleInput?.('\r');

    await vi.waitFor(() => expect(opened).toHaveLength(3));
    overlay?.handleInput?.('a');
    overlay?.handleInput?.('d');
    overlay?.handleInput?.('a');
    overlay?.handleInput?.('\r');

    await vi.waitFor(() => expect(results).toEqual(['green', true, 'ada']));
    expect(closeCount).toBe(3);
  });

  it('exposes a promise-based multi-line editor dialog to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const results: unknown[] = [];
    let overlay: { handleInput?: (data: string) => void } | undefined;
    let closeCount = 0;

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('e', 'Editor dialog', async () => {
        results.push(await host.editor('Edit prompt', 'seed'));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component as typeof overlay;
      },
      closeOverlay: () => {
        overlay = undefined;
        closeCount += 1;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('e')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());

    overlay?.handleInput?.('!');
    overlay?.handleInput?.('\r');

    await vi.waitFor(() => expect(results).toEqual(['seed!']));
    expect(overlay).toBeUndefined();
    expect(closeCount).toBe(1);
  });

  it('cancels extension editor dialogs with the select cancel keybinding', async () => {
    const registry = new ExtensionRegistryImpl();
    const results: unknown[] = [];
    let overlay: { handleInput?: (data: string) => void } | undefined;

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('e', 'Editor dialog', async () => {
        results.push(await host.editor('Edit prompt', 'seed'));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      keybindings: new XopcKeybindingsManager({ 'tui.select.cancel': 'q' }),
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component as typeof overlay;
      },
      closeOverlay: () => {
        overlay = undefined;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('e')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());

    overlay?.handleInput?.('q');

    await vi.waitFor(() => expect(results).toEqual([undefined]));
    expect(overlay).toBeUndefined();
  });

  it('exposes promise-based custom overlay components to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const results: unknown[] = [];
    let done: ((result: string) => void) | undefined;
    let overlay: unknown;
    let closeCount = 0;
    const dispose = vi.fn();

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('c', 'Custom overlay', async () => {
        const result = await host.custom<string>((finish) => {
          done = finish;
          return {
            dispose,
            render: () => ['custom'],
            handleInput: () => {},
          };
        });
        results.push(result);
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component;
      },
      closeOverlay: () => {
        overlay = undefined;
        closeCount += 1;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('c')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());

    done?.('finished');

    await vi.waitFor(() => expect(results).toEqual(['finished']));
    expect(overlay).toBeUndefined();
    expect(closeCount).toBe(1);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('passes custom overlay options and handles through the TUI runtime', async () => {
    const registry = new ExtensionRegistryImpl();
    const overlayOptions: unknown[] = [];
    const handles: unknown[] = [];
    const handle = {
      hide: vi.fn(),
      setHidden: vi.fn(),
      isHidden: vi.fn(() => false),
      focus: vi.fn(),
      unfocus: vi.fn(),
      isFocused: vi.fn(() => true),
    };

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('c', 'Custom overlay options', () => {
        void host.custom<string>(
          (finish) => ({
            width: 42,
            render: () => ['custom'],
            handleInput: () => finish('done'),
          }),
          {
            onHandle: (nextHandle) => handles.push(nextHandle),
          },
        );
      });
      host.registerShortcut('o', 'Explicit custom overlay options', () => {
        void host.custom<string>(
          (finish) => ({
            width: 42,
            render: () => ['custom'],
            handleInput: () => finish('done'),
          }),
          {
            overlayOptions: () => ({
              width: '80%',
              maxHeight: 12,
              anchor: 'bottom-right',
              nonCapturing: true,
            }),
          },
        );
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (_component, options) => {
        overlayOptions.push(options);
        return handle;
      },
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('c')).toBe(true);
    await vi.waitFor(() => expect(overlayOptions).toHaveLength(1));
    expect(overlayOptions[0]).toEqual({ width: 42 });
    expect(handles).toEqual([handle]);

    expect(runtime.handleShortcut('o')).toBe(true);
    await vi.waitFor(() => expect(overlayOptions).toHaveLength(2));
    expect(overlayOptions[1]).toEqual({
      width: '80%',
      maxHeight: 12,
      anchor: 'bottom-right',
      nonCapturing: true,
    });
  });

  it('supports pi-style custom factories with TUI, theme, keybindings, and done', async () => {
    const registry = new ExtensionRegistryImpl();
    const tui = { requestRender: vi.fn() };
    const keybindings = new XopcKeybindingsManager({ 'app.abort': 'escape' });
    const argsSeen: unknown[] = [];
    let done: ((result: string) => void) | undefined;
    const results: string[] = [];

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('c', 'Custom overlay', async () => {
        const result = await host.custom<string>((nextTui, nextTheme, nextKeybindings, finish) => {
          argsSeen.push(nextTui, nextTheme, nextKeybindings);
          done = finish;
          return {
            render: () => ['custom'],
            handleInput: () => {},
          };
        });
        results.push(result);
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: tui as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      keybindings,
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('c')).toBe(true);
    await vi.waitFor(() => expect(argsSeen).toHaveLength(3));
    expect(argsSeen[0]).toBe(tui);
    expect(argsSeen[2]).toBe(keybindings);

    done?.('finished');
    await vi.waitFor(() => expect(results).toEqual(['finished']));
  });

  it('disposes active custom overlays when the TUI extension runtime is disposed', async () => {
    const registry = new ExtensionRegistryImpl();
    let overlay: unknown;
    let closeCount = 0;
    const dispose = vi.fn();

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('c', 'Custom overlay', () => {
        void host.custom<string>(() => ({
          dispose,
          render: () => ['custom'],
          handleInput: () => {},
        }));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component;
      },
      closeOverlay: () => {
        overlay = undefined;
        closeCount += 1;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('c')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());

    runtime.dispose();

    expect(overlay).toBeUndefined();
    expect(closeCount).toBe(1);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('registers terminal input listeners and disposes them', async () => {
    const registry = new ExtensionRegistryImpl();
    const handlers: Array<(data: string) => { consume?: boolean; data?: string } | undefined> = [];
    const unsubscribed: number[] = [];
    let unsubscribeOne: (() => void) | undefined;

    registry.addTuiRegistration('demo', (host) => {
      unsubscribeOne = host.onTerminalInput((data) => {
        if (data === 'x') return { consume: true };
        if (data === 'a') return { data: 'b' };
        return undefined;
      });
      host.onTerminalInput((data) => {
        if (data === 'z') return { data: 'zz' };
        return undefined;
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      addInputListener: (handler) => {
        handlers.push(handler);
        const index = handlers.length - 1;
        return () => {
          unsubscribed.push(index);
        };
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(handlers).toHaveLength(2);
    expect(handlers[0]?.('x')).toEqual({ consume: true });
    expect(handlers[0]?.('a')).toEqual({ data: 'b' });
    expect(handlers[1]?.('z')).toEqual({ data: 'zz' });

    unsubscribeOne?.();
    expect(unsubscribed).toEqual([0]);
    runtime.dispose();
    expect(unsubscribed).toEqual([0, 1]);
  });

  it('exposes terminal title and editor text controls to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const setTitle = vi.fn();
    const pasteToEditor = vi.fn();
    const setEditorText = vi.fn();

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('e', 'Editor controls', () => {
        host.setTitle('Custom title');
        host.pasteToEditor('pasted text');
        host.setEditorText('replacement text');
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setTitle,
      pasteToEditor,
      setEditorText,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('e')).toBe(true);
    await vi.waitFor(() => expect(setTitle).toHaveBeenCalledWith('Custom title'));
    expect(pasteToEditor).toHaveBeenCalledWith('pasted text');
    expect(setEditorText).toHaveBeenCalledWith('replacement text');
  });

  it('cleans up extension dialogs on abort and timeout', async () => {
    const registry = new ExtensionRegistryImpl();
    const results: unknown[] = [];
    const abortController = new AbortController();
    let overlay: unknown;
    let closeCount = 0;

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('a', 'Abort dialog', async () => {
        results.push(await host.select('Abort?', ['yes'], { signal: abortController.signal }));
      });
      host.registerShortcut('t', 'Timeout dialog', async () => {
        results.push(await host.input('Timeout', undefined, { timeout: 5 }));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main', sessionInfo: {} }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: (component) => {
        overlay = component;
      },
      closeOverlay: () => {
        overlay = undefined;
        closeCount += 1;
      },
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('a')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());
    abortController.abort();
    await vi.waitFor(() => expect(results).toEqual([undefined]));

    expect(runtime.handleShortcut('t')).toBe(true);
    await vi.waitFor(() => expect(overlay).toBeDefined());
    await vi.waitFor(() => expect(results).toEqual([undefined, undefined]));
    expect(closeCount).toBe(2);
  });

  it('assigns distinct invocation names to duplicate extension slash commands', async () => {
    const registry = new ExtensionRegistryImpl();
    registry.addTuiRegistration('demo-a', (host) => {
      host.registerSlashCommand('demo', 'First demo command', () => {});
    });
    registry.addTuiRegistration('demo-b', (host) => {
      host.registerSlashCommand('demo', 'Second demo command', () => {});
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main' }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();

    expect(runtime.slashCommands.map((command) => command.name)).toEqual(['demo:1', 'demo:2']);
    expect(runtime.slashCommands[0]?.getContext().getCommands()).toEqual([
      { name: 'demo:1', description: 'First demo command', source: 'extension' },
      { name: 'demo:2', description: 'Second demo command', source: 'extension' },
    ]);

    const suggestions = await runtime.autocompleteProvider.getSuggestions(
      ['/demo:'],
      0,
      '/demo:'.length,
      { signal: new AbortController().signal },
    );
    expect(suggestions?.items.map((item) => item.value)).toEqual(['/demo:1', '/demo:2']);
  });

  it('does not suggest extension commands whose original name conflicts with built-ins', async () => {
    const registry = new ExtensionRegistryImpl();
    registry.addTuiRegistration('demo-a', (host) => {
      host.registerSlashCommand('help', 'First conflicting help', () => {});
    });
    registry.addTuiRegistration('demo-b', (host) => {
      host.registerSlashCommand('help', 'Second conflicting help', () => {});
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main' }) as never,
      baseSlashCommands: [{ name: 'help', description: 'Show help' }],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.slashCommands.map((command) => command.name)).toEqual(['help:1', 'help:2']);

    const suggestions = await runtime.autocompleteProvider.getSuggestions(
      ['/help:'],
      0,
      '/help:'.length,
      { signal: new AbortController().signal },
    );
    const values = suggestions?.items.map((item) => item.value) ?? [];
    expect(values).not.toContain('/help:1');
    expect(values).not.toContain('/help:2');
  });

  it('wraps the active autocomplete provider with pi-style extension factories', async () => {
    const registry = new ExtensionRegistryImpl();
    registry.addTuiRegistration('demo', (host) => {
      host.addAutocompleteProvider((current) => ({
        triggerCharacters: ['#'],
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          const base = await current.getSuggestions(lines, cursorLine, cursorCol, options);
          if (!base || !lines[cursorLine]?.startsWith('/')) return base;
          return {
            ...base,
            items: [
              ...base.items,
              { value: '/wrapped', label: 'wrapped', description: 'Wrapped command' },
            ],
          };
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          if (item.value === '/wrapped') {
            return {
              lines: ['wrapped applied'],
              cursorLine: 0,
              cursorCol: 'wrapped applied'.length,
            };
          }
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
        },
      }));
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main' }) as never,
      baseSlashCommands: [{ name: 'help', description: 'Show help' }],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    const suggestions = await runtime.autocompleteProvider.getSuggestions(
      ['/'],
      0,
      1,
      { signal: new AbortController().signal },
    );
    expect(suggestions?.items.map((item) => item.value)).toContain('/wrapped');

    const applied = runtime.autocompleteProvider.applyCompletion(
      ['/'],
      0,
      1,
      { value: '/wrapped', label: 'wrapped' },
      '/',
    );
    expect(applied).toEqual({
      lines: ['wrapped applied'],
      cursorLine: 0,
      cursorCol: 'wrapped applied'.length,
    });
  });

  it('dispose clears extension commands, shortcuts, widgets, and allows reactivation', async () => {
    const registry = new ExtensionRegistryImpl();
    let activated = 0;
    registry.addTuiRegistration('demo', (host) => {
      activated += 1;
      host.setHeaderWidget('banner', [`banner-${activated}`]);
      host.setFooterWidget('footer', [`footer-${activated}`]);
      host.setStatus('sync', `ok-${activated}`);
      host.setHiddenThinkingLabel(`Thinking-${activated}`);
      host.setWorkingMessage(`Working-${activated}`);
      host.setWorkingVisible(false);
      host.setWorkingIndicator({ frames: [`${activated}`] });
      host.registerSlashCommand('demo', 'Demo command', () => {});
      host.registerShortcut('x', 'Demo shortcut', () => {});
    });

    const headerLines: string[][] = [];
    const footerLines: string[][] = [];
    const statusParts: string[][] = [];
    const hiddenThinkingLabels: Array<string | undefined> = [];
    const workingMessages: Array<string | undefined> = [];
    const workingVisible: boolean[] = [];
    const workingIndicators: Array<{ frames?: string[]; intervalMs?: number } | undefined> = [];
    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: {
        addSystem: () => {},
        setHiddenThinkingLabel: (label?: string) => hiddenThinkingLabels.push(label),
      } as never,
      header: { setExtensionLines: (lines: string[]) => headerLines.push(lines) } as never,
      bottomBar: {
        setExtensionLines: (lines: string[]) => footerLines.push(lines),
        setExtensionStatusParts: (parts: string[]) => statusParts.push(parts),
      } as never,
      getState: () => ({ currentSessionKey: 'agent:main:main' }) as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      setWorkingMessage: (message?: string) => workingMessages.push(message),
      setWorkingVisible: (visible: boolean) => workingVisible.push(visible),
      setWorkingIndicator: (indicator) => workingIndicators.push(indicator),
    });

    await runtime.activate();
    expect(runtime.slashCommands.map((command) => command.name)).toEqual(['demo']);
    expect(runtime.handleShortcut('x')).toBe(true);
    expect(headerLines.at(-1)).toEqual(['banner-1']);
    expect(footerLines.at(-1)).toEqual(['footer-1']);
    expect(statusParts.at(-1)).toEqual(['ok-1']);
    expect(hiddenThinkingLabels.at(-1)).toBe('Thinking-1');
    expect(workingMessages.at(-1)).toBe('Working-1');
    expect(workingVisible.at(-1)).toBe(false);
    expect(workingIndicators.at(-1)).toEqual({ frames: ['1'] });

    runtime.dispose();
    expect(runtime.slashCommands).toEqual([]);
    expect(runtime.shortcuts).toEqual([]);
    expect(runtime.handleShortcut('x')).toBe(false);
    expect(headerLines.at(-1)).toEqual([]);
    expect(footerLines.at(-1)).toEqual([]);
    expect(statusParts.at(-1)).toEqual([]);
    expect(hiddenThinkingLabels.at(-1)).toBeUndefined();
    expect(workingMessages.at(-1)).toBeUndefined();
    expect(workingVisible.at(-1)).toBe(true);
    expect(workingIndicators.at(-1)).toBeUndefined();

    await runtime.activate();
    expect(runtime.slashCommands.map((command) => command.name)).toEqual(['demo']);
    expect(runtime.slashCommands).toHaveLength(1);
    expect(headerLines.at(-1)).toEqual(['banner-2']);
    expect(hiddenThinkingLabels.at(-1)).toBe('Thinking-2');
    expect(workingMessages.at(-1)).toBe('Working-2');
    expect(workingVisible.at(-1)).toBe(false);
    expect(workingIndicators.at(-1)).toEqual({ frames: ['2'] });
  });
});
