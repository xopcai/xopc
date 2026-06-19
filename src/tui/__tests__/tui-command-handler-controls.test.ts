import { describe, expect, it, vi } from 'vitest';

import { createXopcTuiKeybindingsManager } from '../tui-keybindings-file.js';
import { createTuiCommandHandler } from '../tui-commands.js';

describe('tui command handler controls', () => {
  it('routes recover and retry commands to runtime controls', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const calls: string[] = [];
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: () => {},
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('recover/retry should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      recoverStream: async () => {
        calls.push('recover');
      },
      retryLastMessage: async () => {
        calls.push('retry');
      },
    });

    handler('/recover');
    handler('/retry');
    await Promise.resolve();

    expect(calls).toEqual(['recover', 'retry']);
  });

it('handles thinking command through native TUI controls', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    let opened = 0;
    let level: string | undefined;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {},
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      uiOverlays: {
        openModelPicker: () => {},
        openSessionPicker: () => {},
        openSessionTree: () => {},
        openTranscriptTree: () => {},
        openUserMessageFork: () => {},
        openScopedModels: () => {},
        openThinkingSelector: () => {
          opened += 1;
        },
        openSettings: () => {},
        openProjectTrust: () => {},
        reloadKeybindings: () => {},
      },
      setThinkingLevel: async (next) => {
        level = next;
      },
    });

    handler('/think');
    handler('/think high');
    await Promise.resolve();

    expect(opened).toBe(1);
    expect(level).toBe('high');

    handler('/think nope');
    expect(systems.at(-1)).toBe('Invalid thinking level: nope');
  });

  it('handles reasoning command through native TUI controls', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    let level: string | undefined;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: { reasoningLevel: 'stream' },
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('reasoning should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      setReasoningLevel: async (next) => {
        level = next;
      },
    });

    handler('/reasoning');
    expect(systems.at(-1)).toBe('Reasoning visibility: stream');

    handler('/reasoning off');
    await Promise.resolve();
    expect(level).toBe('off');

    handler('/reasoning nope');
    expect(systems.at(-1)).toBe('Invalid reasoning visibility: nope');
  });

  it('handles verbose command through native TUI controls', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    const levels: string[] = [];
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: { verboseLevel: 'full' },
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('verbose should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      setVerboseLevel: async (next) => {
        levels.push(next);
      },
    });

    handler('/verbose');
    await Promise.resolve();
    expect(levels.at(-1)).toBe('off');

    handler('/verbose on');
    await Promise.resolve();
    expect(levels.at(-1)).toBe('on');

    handler('/verbose nope');
    expect(systems.at(-1)).toBe('Invalid verbose level: nope');
  });

  it('handles copy command through injected clipboard action', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    let copied = 0;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: () => {},
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {},
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      copyLastAssistant: async () => {
        copied += 1;
      },
    });

    handler('/copy');
    await Promise.resolve();

    expect(copied).toBe(1);
  });

  it('handles session name command', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    let renamed: string | undefined;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: { displayName: 'Existing name' },
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {},
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      renameCurrentSession: async (name) => {
        renamed = name;
      },
    });

    handler('/name');
    expect(systems.at(-1)).toBe('Session name: Existing name');

    handler('/name Focused work');
    await Promise.resolve();
    expect(renamed).toBe('Focused work');
  });

  it('handles session, usage, context, and config status commands locally', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    const getSessionStats = vi.fn(async () => ({
      totalMessages: 4,
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 2,
      toolResults: 1,
      contextRows: 1,
      tokens: { input: 120, output: 34, cacheRead: 10, cacheWrite: 5, total: 169 },
    }));
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        isConnected: false,
        connectionStatus: 'offline',
        activityStatus: 'idle',
        sessionInfo: {
          displayName: 'Main chat',
          contextUsagePercent: 12,
          totalTokens: 120,
          contextWindow: 1_000,
        },
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('status should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      getSessionStats,
    });

    handler('/session');
    await vi.waitFor(() => expect(systems.at(-1)).toContain('Name: Main chat'));
    expect(systems.at(-1)).toContain('Name: Main chat');
    expect(systems.at(-1)).toContain('Connection: disconnected (offline)');
    expect(systems.at(-1)).toContain('Tool Calls: 2');

    handler('/status');
    await vi.waitFor(() => expect(systems.at(-1)).toContain('Context: 12%/1.0k ctx'));
    expect(systems.at(-1)).toContain('Context: 12%/1.0k ctx');

    handler('/usage');
    await vi.waitFor(() => expect(systems.at(-1)).toContain('Estimated Tokens: 120'));
    expect(systems.at(-1)).toContain('Estimated Tokens: 120');
    expect(systems.at(-1)).toContain('Input: 120');

    handler('/context');
    expect(systems.at(-1)).toContain('Remaining: 880');

    handler('/config');
    expect(systems.at(-1)).toContain('Session: agent:main:main');

    handler('/changelog');
    expect(systems.at(-1)).toContain("What's New");
  });

  it('handles session list, tree, model listing, and switching locally', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    const systems: string[] = [];
    let switched: string | undefined;
    let openedTree = 0;
    let openedTranscriptTree = 0;
    let openedUserMessageFork = 0;
    let loadedTree = 0;
    let forkedRawKey: string | undefined;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        isConnected: true,
        connectionStatus: 'ready',
        activityStatus: 'idle',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('model commands should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      uiOverlays: {
        openModelPicker: (initialSearch?: string) => {
          systems.push(`model picker: ${initialSearch ?? ''}`);
        },
        openSessionPicker: () => {},
        openSessionTree: () => {
          openedTree += 1;
        },
        openTranscriptTree: () => {
          openedTranscriptTree += 1;
        },
        openUserMessageFork: () => {
          openedUserMessageFork += 1;
        },
        openScopedModels: () => {},
        openThinkingSelector: () => {},
        openSettings: () => {},
        openProjectTrust: () => {},
        reloadKeybindings: () => {},
      },
      listSessions: async () => [
        { key: 'agent:main:main', displayName: 'Main chat', messageCount: 2 },
      ],
      loadTranscriptTree: async () => {
        loadedTree += 1;
        return [{ id: 'row-1', depth: 0, label: 'user', role: 'user', turn: 1, preview: 'hello' }];
      },
      listModels: async () => [{ provider: 'openai', id: 'gpt-5', name: 'GPT-5' }],
      switchModel: async (modelRef) => {
        switched = modelRef;
      },
      forkSession: async (rawKey) => {
        forkedRawKey = rawKey;
      },
    });

    handler('/list');
    await Promise.resolve();
    expect(systems.at(-1)).toContain('* Main chat');
    expect(systems.at(-1)).toContain('2 msgs');

    handler('/tree');
    await Promise.resolve();
    expect(openedTree).toBe(0);
    expect(openedTranscriptTree).toBe(1);
    expect(loadedTree).toBe(0);

    handler('/fork');
    expect(openedUserMessageFork).toBe(1);

    handler('/clone');
    await Promise.resolve();
    expect(forkedRawKey).toBeUndefined();

    handler('/clone target-session');
    await Promise.resolve();
    expect(forkedRawKey).toBe('target-session');

    handler('/models');
    await Promise.resolve();
    expect(systems.at(-1)).toContain('openai/gpt-5 — GPT-5');

    handler('/model gpt');
    expect(systems.at(-1)).toBe('model picker: gpt');

    handler('/switch');
    expect(systems.at(-1)).toBe('Usage: /switch <provider/model>');

    handler('/switch openai/gpt-5');
    await Promise.resolve();
    expect(switched).toBe('openai/gpt-5');
  });

  it('handles export command locally', async () => {
    const keybindings = createXopcTuiKeybindingsManager();
    let request: unknown;
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: () => {},
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('export should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings,
      exportSession: async (next) => {
        request = next;
      },
    });

    handler('/export json out.json');
    await Promise.resolve();
    expect(request).toEqual({ format: 'json', outputPath: 'out.json' });
  });

  it('handles btw command locally', async () => {
    const systems: string[] = [];
    const questions: string[] = [];
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('btw should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings: createXopcTuiKeybindingsManager(),
      runBtwQuery: async (question) => {
        questions.push(question);
      },
    });

    handler('/btw');
    expect(systems.at(-1)).toContain('Usage: /btw <question>');

    handler('/btw summarize the last answer');
    await Promise.resolve();
    expect(questions.at(-1)).toBe('summarize the last answer');

    handler('/aside quick check');
    await Promise.resolve();
    expect(questions.at(-1)).toBe('quick check');
  });

  it('handles workflow listing and view locally', () => {
    const systems: string[] = [];
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('workflow commands should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings: createXopcTuiKeybindingsManager(),
    });

    handler('/workflows');
    expect(systems.at(-1)).toContain('Workflows');
    expect(systems.at(-1)).toContain('audit_repo');

    handler('/workflow view audit_repo');
    expect(systems.at(-1)).toContain('Workflow: audit_repo');

    handler('/workflow save demo');
    expect(systems.at(-1)).toContain('/workflow save');
  });

  it('handles start command locally', () => {
    const systems: string[] = [];
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('start should not be sent to the assistant');
      },
      requestExit: () => {},
      updateFooter: () => {},
      keybindings: createXopcTuiKeybindingsManager(),
    });

    handler('/start');
    expect(systems.at(-1)).toContain('xopc TUI');
  });

  it('handles quit command locally', () => {
    const requestExit = vi.fn();
    const handler = createTuiCommandHandler({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: {},
        toolsExpanded: false,
        showThinking: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      chatLog: {
        addSystem: () => {},
        setToolsExpanded: () => {},
      } as never,
      tui: { requestRender: () => {} } as never,
      isLocalMode: true,
      abortActive: async () => {},
      sendMessage: () => {
        throw new Error('quit should not be sent to the assistant');
      },
      requestExit,
      updateFooter: () => {},
      keybindings: createXopcTuiKeybindingsManager(),
    });

    handler('/quit');
    expect(requestExit).toHaveBeenCalledOnce();
  });
});
