import { describe, expect, it, vi } from 'vitest';

import { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { createTuiExtensionRuntime } from '../extension-host/runtime.js';
import { TuiBottomBar } from '../components/tui-bottom-bar.js';
import { TuiHeader } from '../components/tui-header.js';
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('createTuiExtensionRuntime context and widgets', () => {
it('invokes extension shortcuts with TUI context', async () => {
    const registry = new ExtensionRegistryImpl();
    const state = {
      currentSessionKey: 'agent:main:main',
      activeRunId: null as string | null,
      isCompacting: false,
      pendingInputCount: 0,
      activityStatus: 'idle' as 'idle' | 'streaming',
      compactionQueue: [] as string[],
      sessionInfo: {
        modelProvider: 'openai',
        model: 'gpt-5',
        contextTokens: 400,
        contextWindow: 1000,
      },
    };
    let seen:
      | {
          mode: 'tui';
          hasUI: boolean;
          signal: AbortSignal | undefined;
          cwd: string;
          sessionKey: string;
          trusted: boolean;
          uiEditorText: string;
          uiTheme: unknown;
          model: unknown;
          registryModel: unknown;
          registryAuth: unknown;
          entries: unknown[];
          leafId: string | null;
          idle: boolean;
          pendingMessages: boolean;
        }
      | undefined;
    const abortController = new AbortController();
    const abortActive = vi.fn(async () => {});
    const requestExit = vi.fn();
    const compactResult = {
      compacted: true,
      summary: 'Compacted',
      tokensBefore: 1200,
      tokensAfter: 300,
    };
    const compactComplete = vi.fn();
    const compactError = vi.fn();
    const compactSession = vi.fn(async (options?: {
      onComplete?: (result: typeof compactResult) => void;
    }) => {
      options?.onComplete?.(compactResult);
      return compactResult;
    });
    const registryModel = {
      provider: 'google',
      id: 'gemini-2.5-flash',
      ref: 'google/gemini-2.5-flash',
      contextWindow: 1_000_000,
    };
    const getApiKeyAndHeaders = vi.fn(async () => ({
      ok: true as const,
      apiKey: 'test-key',
      headers: { 'x-test': '1' },
    }));
    const setModel = vi.fn(async () => {});
    const setThinkingLevel = vi.fn(async () => {});
    const setReasoningLevel = vi.fn(async () => {});
    const setVerboseLevel = vi.fn(async () => {});
    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('x', 'Demo shortcut', async (ctx) => {
        const foundModel = ctx.modelRegistry.find('google', 'gemini-2.5-flash');
        const auth = foundModel
          ? await ctx.modelRegistry.getApiKeyAndHeaders(foundModel)
          : undefined;
        seen = {
          mode: ctx.mode,
          hasUI: ctx.hasUI,
          signal: ctx.signal,
          cwd: ctx.cwd,
          sessionKey: ctx.sessionKey,
          trusted: ctx.isProjectTrusted(),
          uiEditorText: ctx.ui.getEditorText(),
          uiTheme: ctx.ui.theme,
          model: ctx.model,
          registryModel: foundModel,
          registryAuth: auth,
          entries: ctx.sessionManager.getEntries(),
          leafId: ctx.sessionManager.getLeafId(),
          leafLabel: ctx.sessionManager.getLabel('entry-1'),
          systemPrompt: ctx.getSystemPrompt(),
          idle: ctx.isIdle(),
          pendingMessages: ctx.hasPendingMessages(),
        };
        ctx.ui.setStatus('runtime', 'shortcut-ok');
        ctx.ui.setWidget('runtime-widget', ['Shortcut widget']);
        await ctx.abort();
        ctx.shutdown();
        await ctx.compact({
          customInstructions: 'preserve decisions',
          onComplete: compactComplete,
          onError: compactError,
        });
        await ctx.setModel('openai/gpt-5');
        await ctx.setThinkingLevel('high');
        await ctx.setReasoningLevel('stream');
        await ctx.setVerboseLevel('full');
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
      getState: () => state as never,
      baseSlashCommands: [{ name: 'help', description: 'Show help' }],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      getActiveSignal: () => abortController.signal,
      isProjectTrusted: () => true,
      getSessionManager: () => ({
        getEntries: () => [{ id: 'entry-1', parentId: null, type: 'message', content: 'hello' }],
        getBranch: () => [{ id: 'entry-1', parentId: null, type: 'message', content: 'hello' }],
        getLeafEntry: () => ({ id: 'entry-1', parentId: null, type: 'message', content: 'hello' }),
        getLeafId: () => 'entry-1',
        getEntry: (entryId) =>
          entryId === 'entry-1'
            ? { id: 'entry-1', parentId: null, type: 'message', content: 'hello' }
            : undefined,
        getLabel: (entryId) => (entryId === 'entry-1' ? 'important' : undefined),
        getHeader: () => ({
          type: 'session',
          version: 3,
          id: 'agent:main:main',
          timestamp: '1970-01-01T00:00:00.000Z',
          cwd: '/tmp/work',
        }),
        getTree: () => [
          {
            entry: { id: 'entry-1', parentId: null, type: 'message', content: 'hello' },
            children: [],
            label: 'important',
          },
        ],
        getSessionId: () => 'agent:main:main',
        getSessionFile: () => '/tmp/xopc.db#session=agent%3Amain%3Amain',
        getSessionDir: () => '/tmp/.xopc',
        getSessionName: () => 'Main',
        getCwd: () => '/tmp/work',
      }),
      getModelRegistry: () => ({
        find: (provider, modelId) =>
          provider === registryModel.provider && modelId === registryModel.id
            ? registryModel
            : undefined,
        getApiKeyAndHeaders,
      }),
      getSystemPrompt: () => 'system prompt text',
      getEditorText: () => 'draft from editor',
      getThemeObject: () => ({ name: 'active-theme' }),
      abortActive,
      requestExit,
      compactSession,
      setModel,
      setThinkingLevel,
      setReasoningLevel,
      setVerboseLevel,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('x')).toBe(true);
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen).toEqual({
      mode: 'tui',
      hasUI: true,
      signal: abortController.signal,
      cwd: '/tmp/work',
      sessionKey: 'agent:main:main',
      trusted: true,
      uiEditorText: 'draft from editor',
      systemPrompt: 'system prompt text',
      uiTheme: { name: 'active-theme' },
      model: {
        provider: 'openai',
        id: 'gpt-5',
        ref: 'openai/gpt-5',
        contextWindow: 1000,
      },
      registryModel,
      registryAuth: {
        ok: true,
        apiKey: 'test-key',
        headers: { 'x-test': '1' },
      },
      entries: [{ id: 'entry-1', parentId: null, type: 'message', content: 'hello' }],
      leafId: 'entry-1',
      leafLabel: 'important',
      idle: true,
      pendingMessages: false,
    });
    expect(runtime.surface.getStatusParts()).toEqual(['shortcut-ok']);
    expect(runtime.surface.getHeaderLines()).toEqual(['Shortcut widget']);
    expect(getApiKeyAndHeaders).toHaveBeenCalledWith(registryModel);
    await vi.waitFor(() => expect(abortActive).toHaveBeenCalledOnce());
    expect(requestExit).toHaveBeenCalledOnce();
    expect(compactSession).toHaveBeenCalledWith({
      customInstructions: 'preserve decisions',
      onComplete: compactComplete,
      onError: compactError,
    });
    expect(compactComplete).toHaveBeenCalledWith(compactResult);
    expect(compactError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledWith('openai/gpt-5'));
    await vi.waitFor(() => expect(setThinkingLevel).toHaveBeenCalledWith('high'));
    await vi.waitFor(() => expect(setReasoningLevel).toHaveBeenCalledWith('stream'));
    await vi.waitFor(() => expect(setVerboseLevel).toHaveBeenCalledWith('full'));
    state.activeRunId = 'run-1';
    state.pendingInputCount = 1;
    abortController.abort();
    expect(runtime.handleShortcut('x')).toBe(true);
    await vi.waitFor(() => expect(seen).toMatchObject({ idle: false, pendingMessages: true }));
    expect(seen?.signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(abortActive).toHaveBeenCalledTimes(2));
    expect(requestExit).toHaveBeenCalledTimes(2);
    expect(compactSession).toHaveBeenCalledTimes(2);
    expect(compactComplete).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(setThinkingLevel).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(setReasoningLevel).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(setVerboseLevel).toHaveBeenCalledTimes(2));
    expect(runtime.handleShortcut('y')).toBe(false);
  });

  it('exposes live TUI context to extension slash commands', async () => {
    const registry = new ExtensionRegistryImpl();
    const state = {
      currentSessionKey: 'agent:main:main',
      activeRunId: null as string | null,
      isCompacting: false,
      pendingInputCount: 0,
      activityStatus: 'idle' as 'idle' | 'streaming',
      compactionQueue: [] as string[],
      sessionInfo: {
        modelProvider: 'openai',
        model: 'gpt-5',
        thinkingLevel: 'medium',
        reasoningLevel: 'stream',
        verboseLevel: 'full',
        contextTokens: 400,
        contextWindow: 1000,
      },
    };
    registry.addTuiRegistration('demo', (host) => {
      host.registerSlashCommand('demo', 'Demo command', () => {});
    });
    const waitForIdle = vi.fn(async () => {});
    const newSession = vi.fn(async () => ({ cancelled: false }));
    const forkSession = vi.fn(async () => ({ cancelled: false }));
    const navigateTree = vi.fn(async () => ({ cancelled: false }));
    const switchSession = vi.fn(async () => ({ cancelled: false }));
    const reload = vi.fn(async () => {});

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header: { setExtensionLines: () => {} } as never,
      bottomBar: {
        setExtensionLines: () => {},
        setExtensionStatusParts: () => {},
      } as never,
      getState: () => state as never,
      baseSlashCommands: [{ name: 'help', description: 'Show help' }],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      getSystemPrompt: () => 'system prompt',
      waitForIdle,
      newSession,
      forkSession,
      navigateTree,
      switchSession,
      reload,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    const context = runtime.slashCommands[0]?.getContext();
    expect(context?.mode).toBe('tui');
    expect(context?.hasUI).toBe(true);
    expect(context?.signal).toBeUndefined();
    expect(context?.cwd).toBe('/tmp/work');
    expect(context?.sessionKey).toBe('agent:main:main');
    expect(context?.isProjectTrusted()).toBe(false);
    expect(context?.sessionManager.getSessionId()).toBe('agent:main:main');
    expect(context?.sessionManager.getCwd()).toBe('/tmp/work');
    expect(context?.sessionManager.getSessionFile()).toBeUndefined();
    expect(context?.sessionManager.getSessionDir()).toBeUndefined();
    expect(context?.sessionManager.getEntries()).toEqual([]);
    expect(context?.sessionManager.getLeafId()).toBeNull();
    expect(context?.isIdle()).toBe(true);
    expect(context?.hasPendingMessages()).toBe(false);
    expect(context?.getContextUsage()).toEqual({
      estimatedTokens: 400,
      tokens: 400,
      contextWindow: 1000,
      usagePercent: 40,
      percent: 40,
    });
    expect(context?.getModel()).toEqual({
      provider: 'openai',
      id: 'gpt-5',
      ref: 'openai/gpt-5',
      contextWindow: 1000,
    });
    expect(context?.model).toEqual({
      provider: 'openai',
      id: 'gpt-5',
      ref: 'openai/gpt-5',
      contextWindow: 1000,
    });
    expect(context?.getThinkingLevel()).toBe('medium');
    expect(context?.getReasoningLevel()).toBe('stream');
    expect(context?.getVerboseLevel()).toBe('full');
    expect(context?.getCommands()).toEqual([
      { name: 'help', description: 'Show help', source: 'builtin' },
      { name: 'demo', description: 'Demo command', source: 'extension' },
    ]);
    expect(context?.getSystemPrompt()).toBe('system prompt');
    expect(context?.getSystemPromptOptions()).toEqual({
      cwd: '/tmp/work',
      sessionKey: 'agent:main:main',
      model: {
        provider: 'openai',
        id: 'gpt-5',
        ref: 'openai/gpt-5',
        contextWindow: 1000,
      },
    });
    await context?.waitForIdle();
    await context?.navigateTree('row-3', { summarize: false, label: 'mark' });
    expect(waitForIdle).toHaveBeenCalledOnce();
    expect(navigateTree).toHaveBeenCalledWith('row-3', { summarize: false, label: 'mark' });
    context?.ui.setStatus('slash', 'slash-ok');
    context?.ui.setWidget('slash-widget', ['Slash widget']);
    expect(runtime.surface.getStatusParts()).toEqual(['slash-ok']);
    expect(runtime.surface.getHeaderLines()).toEqual(['Slash widget']);

    const newSessionContext = runtime.slashCommands[0]?.getContext();
    await newSessionContext?.newSession({ parentSession: 'parent' });
    expect(newSession).toHaveBeenCalledWith({ parentSession: 'parent' });
    expect(() => newSessionContext?.getSystemPrompt()).toThrow('This extension ctx is stale');

    const forkContext = runtime.slashCommands[0]?.getContext();
    await forkContext?.fork('row-2', { position: 'at' });
    expect(forkSession).toHaveBeenCalledWith('row-2', { position: 'at' });
    expect(() => forkContext?.sessionKey).toThrow('This extension ctx is stale');

    const switchContext = runtime.slashCommands[0]?.getContext();
    await switchContext?.switchSession('agent:main:other');
    expect(switchSession).toHaveBeenCalledWith('agent:main:other', undefined);
    expect(() => switchContext?.isIdle()).toThrow('This extension ctx is stale');

    const reloadContext = runtime.slashCommands[0]?.getContext();
    await reloadContext?.reload();
    expect(reload).toHaveBeenCalledOnce();
    expect(() => reloadContext?.mode).toThrow('This extension ctx is stale');

    state.activityStatus = 'streaming';
    state.pendingInputCount = 1;
    state.sessionInfo.reasoningLevel = 'invalid';
    state.sessionInfo.verboseLevel = 'invalid';
    expect(context?.isIdle()).toBe(false);
    expect(context?.hasPendingMessages()).toBe(true);
    expect(context?.getReasoningLevel()).toBeUndefined();
    expect(context?.getVerboseLevel()).toBeUndefined();
  });

  it('exposes current editor text to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const seen: string[] = [];
    let editorText = 'initial prompt';

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('e', 'Read editor', () => {
        seen.push(host.getEditorText());
        host.setEditorText('replacement prompt');
        seen.push(host.getEditorText());
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
      setEditorText: (text) => {
        editorText = text;
      },
      getEditorText: () => editorText,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('e')).toBe(true);
    expect(seen).toEqual(['initial prompt', 'replacement prompt']);
  });

  it('accepts pi-style warning notifications from TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const systemMessages: string[] = [];
    const requestRender = vi.fn();

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('n', 'Notify', () => {
        host.notify('Check this', 'warning');
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender } as never,
      chatLog: {
        addSystem: (message: string) => systemMessages.push(stripAnsi(message)),
        setHiddenThinkingLabel: () => {},
      } as never,
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
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('n')).toBe(true);
    expect(systemMessages).toEqual(['⚠ Check this']);
    expect(requestRender).toHaveBeenCalled();
  });

  it('renders and disposes custom header and footer components from TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const disposeHeaderA = vi.fn();
    const disposeHeaderB = vi.fn();
    const disposeFooter = vi.fn();
    const footerBranches: Array<string | null> = [];
    let branchChangeUnsubscribe: (() => void) | undefined;
    const state = {
      currentSessionKey: 'agent:main:main',
      connectionStatus: 'connected',
      activityStatus: 'idle',
      isCompacting: false,
      pendingInputCount: 0,
      compactionQueue: [],
      showThinking: true,
      sessionInfo: {},
    };
    const header = new TuiHeader(() => ({
      version: '0.0.0',
      connectionLabel: 'connected',
      sessionKey: 'agent:main:main',
      showHints: false,
    }));
    const bottomBar = new TuiBottomBar(() => state as never, () => 'medium');

    registry.addTuiRegistration('demo', (host) => {
      host.setHeader(() => ({
        render: () => ['header-a'],
        dispose: disposeHeaderA,
      }));
      host.setStatus('sync', 'ok');
      host.setFooter((_tui, _theme, footerData) => ({
        render: () => {
          footerBranches.push(footerData.getGitBranch());
          branchChangeUnsubscribe = footerData.onBranchChange(() => {});
          const statuses = [...footerData.getExtensionStatuses().entries()]
            .map(([key, value]) => `${key}=${value}`)
            .join(',');
          return [`footer-a ${statuses} providers:${footerData.getAvailableProviderCount()}`];
        },
        dispose: disposeFooter,
      }));
      host.registerShortcut('h', 'Replace header', () => {
        host.setHeader(() => ({
          render: () => ['header-b'],
          dispose: disposeHeaderB,
        }));
      });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header,
      bottomBar,
      getState: () => state as never,
      baseSlashCommands: [],
      cwd: '/tmp/work',
      fdPath: null,
      openOverlay: () => {},
      closeOverlay: () => {},
      onInvalidate: () => {},
      getAvailableProviderCount: () => 7,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(stripAnsi(header.render(80).join('\n'))).toBe('header-a');
    expect(stripAnsi(bottomBar.render(80).join('\n'))).toBe('footer-a demo:sync=ok providers:7');
    expect(footerBranches).toHaveLength(1);
    expect(branchChangeUnsubscribe).toBeTypeOf('function');

    expect(runtime.handleShortcut('h')).toBe(true);
    expect(disposeHeaderA).toHaveBeenCalledOnce();
    expect(stripAnsi(header.render(80).join('\n'))).toBe('header-b');

    runtime.dispose();
    expect(disposeHeaderB).toHaveBeenCalledOnce();
    expect(disposeFooter).toHaveBeenCalledOnce();
    expect(stripAnsi(header.render(80).join('\n'))).toContain('xopc tui v0.0.0');
    expect(stripAnsi(bottomBar.render(80).join('\n'))).not.toBe('footer-a');
  });

  it('renders and disposes component-backed extension widgets', async () => {
    const registry = new ExtensionRegistryImpl();
    const disposeAbove = vi.fn();
    const disposeBelow = vi.fn();
    const state = {
      currentSessionKey: 'agent:main:main',
      connectionStatus: 'connected',
      activityStatus: 'idle',
      isCompacting: false,
      pendingInputCount: 0,
      compactionQueue: [],
      showThinking: true,
      sessionInfo: {},
    };
    const header = new TuiHeader(() => ({
      version: '0.0.0',
      connectionLabel: 'connected',
      sessionKey: 'agent:main:main',
      showHints: false,
    }));
    const bottomBar = new TuiBottomBar(() => state as never, () => 'medium');

    registry.addTuiRegistration('demo', (host) => {
      host.setWidget('above', () => ({
        render: () => ['above component'],
        dispose: disposeAbove,
      }));
      host.setWidget('below', () => ({
        render: () => ['below component'],
        dispose: disposeBelow,
      }), { placement: 'belowEditor' });
    });

    const runtime = createTuiExtensionRuntime({
      registry,
      tui: { requestRender: () => {} } as never,
      chatLog: { addSystem: () => {}, setHiddenThinkingLabel: () => {} } as never,
      header,
      bottomBar,
      getState: () => state as never,
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
    expect(stripAnsi(header.render(80).join('\n'))).toContain('above component');
    expect(stripAnsi(bottomBar.render(80).join('\n'))).toContain('below component');

    runtime.dispose();
    expect(disposeAbove).toHaveBeenCalledOnce();
    expect(disposeBelow).toHaveBeenCalledOnce();
    expect(stripAnsi(header.render(80).join('\n'))).not.toContain('above component');
    expect(stripAnsi(bottomBar.render(80).join('\n'))).not.toContain('below component');
  });

  it('exposes custom editor component factories to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const factories: unknown[] = [];
    let activeFactory: unknown;

    registry.addTuiRegistration('demo', (host) => {
      const factory = () => ({
        render: () => ['editor'],
        getText: () => 'custom text',
        setText: () => {},
        handleInput: () => {},
      });
      host.setEditorComponent(factory);
      factories.push(host.getEditorComponent());
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
      setEditorComponent: (factory) => {
        activeFactory = factory;
      },
      getEditorComponent: () => activeFactory as never,
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(factories).toEqual([activeFactory]);
    expect(activeFactory).toBeDefined();

    runtime.dispose();
    expect(activeFactory).toBeUndefined();
  });

  it('exposes theme and tool expansion controls to TUI extensions', async () => {
    const registry = new ExtensionRegistryImpl();
    const seen: unknown[] = [];
    let toolsExpanded = false;
    const setTheme = vi.fn((nextTheme: string) => ({ success: nextTheme === 'dark' }));

    registry.addTuiRegistration('demo', (host) => {
      host.registerShortcut('t', 'Theme controls', () => {
        seen.push(host.theme);
        seen.push(host.getAllThemes());
        seen.push(host.getTheme('dark'));
        seen.push(host.setTheme('dark'));
        seen.push(host.getToolsExpanded());
        host.setToolsExpanded(true);
        seen.push(host.getToolsExpanded());
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
      getThemeObject: () => ({ active: true }),
      getAllThemes: () => [{ name: 'dark', path: undefined }],
      getTheme: (name) => ({ name }),
      setTheme,
      getToolsExpanded: () => toolsExpanded,
      setToolsExpanded: (expanded) => {
        toolsExpanded = expanded;
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
    });

    await runtime.activate();
    expect(runtime.handleShortcut('t')).toBe(true);
    expect(seen).toEqual([
      { active: true },
      [{ name: 'dark', path: undefined }],
      { name: 'dark' },
      { success: true },
      false,
      true,
    ]);
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});
