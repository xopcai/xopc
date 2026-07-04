import { describe, expect, it, vi } from 'vitest';

import { ChatLog } from '../components/chat-log.js';
import {
  createTuiCommandHandler,
} from '../tui-commands.js';
import {
  formatTuiShareResult,
  parseTuiShareRequest,
} from '../tui-command-formatters.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { createInitialState } from '../tui-types.js';

function makeHandler(overrides: Partial<Parameters<typeof createTuiCommandHandler>[0]> = {}) {
  const state = createInitialState('agent:main:main');
  const chatLog = new ChatLog();
  const tui = { requestRender: vi.fn() } as unknown as Parameters<
    typeof createTuiCommandHandler
  >[0]['tui'];
  const sendMessage = vi.fn();
  const setSession = vi.fn(async () => {});
  const resetSession = vi.fn(async () => {});
  const abortActive = vi.fn(async () => {});

  const handler = createTuiCommandHandler({
    state,
    chatLog,
    tui,
    isLocalMode: true,
    abortActive,
    sendMessage,
    requestExit: vi.fn(),
    updateFooter: vi.fn(),
    keybindings: new XopcKeybindingsManager(),
    currentAgentId: 'main',
    setSession,
    resetSession,
    ...overrides,
  });

  return { handler, state, sendMessage, setSession, resetSession, abortActive, chatLog };
}

describe('TUI session slash commands', () => {
  it('/new switches session without forwarding to agent', async () => {
    const { handler, sendMessage, setSession } = makeHandler();
    handler('/new');
    await vi.waitFor(() => expect(setSession).toHaveBeenCalledOnce());

    const rawKey = setSession.mock.calls[0]![0] as string;
    expect(rawKey).toMatch(/^tui-[0-9a-f-]{36}$/i);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/reset calls resetSession and does not forward slash to agent', async () => {
    const { handler, sendMessage, resetSession } = makeHandler();
    handler('/reset');
    await vi.waitFor(() => expect(resetSession).toHaveBeenCalledOnce());
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/clear only clears the TUI view without resetting the session', () => {
    const systems: string[] = [];
    const clearAll = vi.fn();
    const { handler, resetSession } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
        clearAll,
      } as never,
    });

    handler('/clear');

    expect(resetSession).not.toHaveBeenCalled();
    expect(clearAll).toHaveBeenCalledOnce();
    expect(systems.at(-1)).toBe('TUI view cleared. Session transcript was not reset.');
  });

  it('/fork calls forkSession and does not forward slash to agent', async () => {
    const forkSession = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({ forkSession });
    handler('/fork custom-fork');
    await vi.waitFor(() => expect(forkSession).toHaveBeenCalledWith('custom-fork'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/agent switches to the same suffix under the target agent', async () => {
    const systems: string[] = [];
    const switchAgentSession = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      state: createInitialState('agent:coder:tui-123'),
      listAgents: vi.fn(async () => [
        { id: 'coder', enabled: true },
        { id: 'main', enabled: true },
      ]),
      switchAgentSession,
    });

    handler('/agent main');

    await vi.waitFor(() => expect(switchAgentSession).toHaveBeenCalledWith('agent:main:tui-123', 'main'));
    expect(systems.at(-1)).toContain('Switched to agent: main');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/agent refuses non-agent current sessions without legacy migration', async () => {
    const systems: string[] = [];
    const switchAgentSession = vi.fn(async () => {});
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      state: createInitialState('global'),
      listAgents: vi.fn(async () => [{ id: 'main', enabled: true }]),
      switchAgentSession,
    });

    handler('/agent main');

    await vi.waitFor(() => expect(systems.at(-1)).toContain('current session is not an agent session'));
    expect(switchAgentSession).not.toHaveBeenCalled();
  });

  it('/agent refuses unknown agents without fallback', async () => {
    const systems: string[] = [];
    const switchAgentSession = vi.fn(async () => {});
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      listAgents: vi.fn(async () => [{ id: 'main', enabled: true }]),
      switchAgentSession,
    });

    handler('/agent researcher');

    await vi.waitFor(() => expect(systems.at(-1)).toContain('Unknown agent: researcher'));
    expect(switchAgentSession).not.toHaveBeenCalled();
  });

  it('/agent refuses switching while a run is active', async () => {
    const systems: string[] = [];
    const state = createInitialState('agent:main:main');
    state.activeRunId = 'run-1';
    const switchAgentSession = vi.fn(async () => {});
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      state,
      listAgents: vi.fn(async () => [{ id: 'coder', enabled: true }]),
      switchAgentSession,
    });

    handler('/agent coder');

    await vi.waitFor(() => expect(systems.at(-1)).toContain('Cannot switch agent while a run is active'));
    expect(switchAgentSession).not.toHaveBeenCalled();
  });

  it('/agents lists available agents', async () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      listAgents: vi.fn(async () => [
        { id: 'main', enabled: true },
        { id: 'coder', enabled: true },
      ]),
    });

    handler('/agents');

    await vi.waitFor(() => expect(systems.at(-1)).toContain('Available agents:'));
    expect(systems.at(-1)).toContain('coder');
    expect(systems.at(-1)).toContain('main');
    expect(systems.at(-1)).toContain('Switch with: /agent <id>');
  });

  it('/tui-default-agent persists the TUI default agent without forwarding to agent', async () => {
    const systems: string[] = [];
    const setTuiDefaultAgent = vi.fn(async (agentId: string) => ({ agentId }));
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      setTuiDefaultAgent,
    });

    handler('/tui-default-agent coder');

    await vi.waitFor(() => expect(setTuiDefaultAgent).toHaveBeenCalledWith('coder'));
    expect(systems.at(-1)).toContain('TUI default agent set to coder');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/tui-default-agent shows usage when no agent id is provided', async () => {
    const systems: string[] = [];
    const listAgents = vi.fn(async () => [{ id: 'coder', enabled: true }]);
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      listAgents,
    });

    handler('/tui-default-agent');

    await vi.waitFor(() => expect(systems.at(-1)).toContain('Usage: /tui-default-agent <agent-id>'));
    expect(systems.at(-1)).toContain('coder');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/share parses and handles workspace share requests locally', async () => {
    const createShare = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({ createShare });

    handler('/share "dist/report.html" public --site --title "Launch Report" --description "Final build"');

    await vi.waitFor(() => expect(createShare).toHaveBeenCalledOnce());
    expect(createShare).toHaveBeenCalledWith({
      path: 'dist/report.html',
      audience: 'public',
      mode: 'force-site',
      title: 'Launch Report',
      description: 'Final build',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/share shows usage without forwarding when path is missing', () => {
    const systems: string[] = [];
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      createShare: vi.fn(async () => {}),
    });

    handler('/share');

    expect(systems.at(-1)).toContain('Usage: /share <workspace-path>');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/help lists registered extension slash commands', () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      extensionSlashCommands: [
        {
          name: 'demo',
          description: 'Demo extension command',
          handler: vi.fn(),
        },
      ],
    });

    handler('/help');

    expect(systems.at(-1)).toContain('Extension commands:');
    expect(systems.at(-1)).toContain('/demo — Demo extension command');
    expect(systems.at(-1)).toContain('/aside — Alias for /btw');
  });

  it('/help lists skill slash commands', () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      skillSlashCommands: [
        { name: 'skill:review', description: 'Apply skill to the next turn' },
      ],
    });

    handler('/help');

    expect(systems.at(-1)).toContain('Skill commands:');
    expect(systems.at(-1)).toContain('/skill:review — Apply skill to the next turn');
  });

  it('forwards skill slash commands to the agent unchanged', () => {
    const { handler, sendMessage } = makeHandler({
      skillSlashCommands: [
        { name: 'skill:review', description: 'Apply skill to the next turn' },
      ],
    });

    handler('/skill:review audit this diff');

    expect(sendMessage).toHaveBeenCalledWith('/skill:review audit this diff');
  });

  it('/help lists workflow slash commands', () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      workflowSlashCommands: [
        { name: 'workflow:audit_repo', description: 'Run workflow' },
      ],
    });

    handler('/help');

    expect(systems.at(-1)).toContain('Workflow commands:');
    expect(systems.at(-1)).toContain('/workflow:audit_repo — Run workflow');
  });

  it('starts workflow slash commands directly without routing through the agent', async () => {
    const systems: string[] = [];
    const startWorkflowRun = vi.fn(async () => ({
      runId: 'run-1',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-1',
      definitionId: 'audit_repo',
    }));
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      workflowSlashCommands: [
        { name: 'workflow:audit_repo', description: 'Run workflow' },
      ],
      startWorkflowRun,
    });

    handler('/workflow:audit_repo review current changes');
    await vi.waitFor(() => expect(startWorkflowRun).toHaveBeenCalledOnce());

    expect(startWorkflowRun).toHaveBeenCalledWith({
      definitionId: 'audit_repo',
      goal: 'review current changes',
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(systems.join('\n')).toContain('Starting workflow: audit_repo');
    expect(systems.join('\n')).toContain('Workflow started: audit_repo');
  });

  it('keeps built-in slash commands ahead of conflicting extension commands', () => {
    const systems: string[] = [];
    const extensionHandler = vi.fn();
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      extensionSlashCommands: [
        {
          name: 'help',
          description: 'Conflicting extension help',
          handler: extensionHandler,
        },
      ],
    });

    handler('/help');

    expect(extensionHandler).not.toHaveBeenCalled();
    expect(systems.at(-1)).toContain('Available commands:');
  });

  it('/help hides disambiguated extension commands that originated from built-in names', () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      extensionSlashCommands: [
        {
          originalName: 'help',
          name: 'help:1',
          description: 'Conflicting extension help',
          handler: vi.fn(),
        },
      ],
    });

    handler('/help');

    expect(systems.at(-1)).not.toContain('/help:1');
  });

  it('passes extension context to registered slash commands', () => {
    const extensionHandler = vi.fn();
    const context = {
      mode: 'tui' as const,
      hasUI: true as const,
      signal: undefined,
      ui: {} as never,
      model: {
        provider: 'openai',
        id: 'gpt-5',
        ref: 'openai/gpt-5',
        contextWindow: 1000,
      },
      cwd: '/tmp/work',
      sessionKey: 'agent:main:main',
      isProjectTrusted: () => false,
      isIdle: () => false,
      hasPendingMessages: () => true,
      abort: vi.fn(async () => {}),
      shutdown: vi.fn(),
      compact: vi.fn(async () => {}),
      getModel: () => ({
        provider: 'openai',
        id: 'gpt-5',
        ref: 'openai/gpt-5',
        contextWindow: 1000,
      }),
      setModel: vi.fn(async () => {}),
      getThinkingLevel: () => 'medium' as const,
      setThinkingLevel: vi.fn(async () => {}),
      getCommands: () => [
        { name: 'demo', description: 'Demo extension command', source: 'extension' as const },
      ],
      getContextUsage: () => ({
        estimatedTokens: 500,
        tokens: 500,
        contextWindow: 1000,
        usagePercent: 50,
        percent: 50,
      }),
      notify: vi.fn(),
    };
    const { handler } = makeHandler({
      extensionSlashCommands: [
        {
          name: 'demo',
          description: 'Demo extension command',
          getContext: () => context,
          handler: (args, ctx) => {
            extensionHandler(
              args,
              ctx?.mode,
              ctx?.hasUI,
              ctx?.cwd,
              ctx?.sessionKey,
              ctx?.isIdle(),
              ctx?.hasPendingMessages(),
              ctx?.getModel(),
              ctx?.getThinkingLevel(),
              ctx?.getCommands(),
              ctx?.getContextUsage(),
            );
            void ctx?.abort();
            ctx?.shutdown();
            void ctx?.compact({ customInstructions: 'keep summary' });
            void ctx?.setModel('openai/gpt-5');
            void ctx?.setThinkingLevel('high');
            ctx?.notify('done', 'info');
          },
        },
      ],
    });

    handler('/demo hello world');

    expect(extensionHandler).toHaveBeenCalledWith(
      'hello world',
      'tui',
      true,
      '/tmp/work',
      'agent:main:main',
      false,
      true,
      { provider: 'openai', id: 'gpt-5', ref: 'openai/gpt-5', contextWindow: 1000 },
      'medium',
      [{ name: 'demo', description: 'Demo extension command', source: 'extension' }],
      { estimatedTokens: 500, tokens: 500, contextWindow: 1000, usagePercent: 50, percent: 50 },
    );
    expect(context.abort).toHaveBeenCalledOnce();
    expect(context.shutdown).toHaveBeenCalledOnce();
    expect(context.compact).toHaveBeenCalledWith({ customInstructions: 'keep summary' });
    expect(context.setModel).toHaveBeenCalledWith('openai/gpt-5');
    expect(context.setThinkingLevel).toHaveBeenCalledWith('high');
    expect(context.notify).toHaveBeenCalledWith('done', 'info');
  });

  it('dispatches extension slash commands with disambiguated colon names', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { handler } = makeHandler({
      extensionSlashCommands: [
        {
          name: 'demo:1',
          description: 'First demo command',
          handler: first,
        },
        {
          name: 'demo:2',
          description: 'Second demo command',
          handler: second,
        },
      ],
    });

    handler('/demo:2 hello');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('hello', undefined);
  });

  it('/hotkeys lists registered extension shortcuts', () => {
    const systems: string[] = [];
    const { handler } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      extensionShortcuts: [
        {
          key: 'ctrl+x',
          description: 'Demo extension shortcut',
        },
      ],
    });

    handler('/hotkeys');

    expect(systems.at(-1)).toContain('Extensions:');
    expect(systems.at(-1)).toContain('Ctrl+X — Demo extension shortcut');
  });

  it('/trust shows extension trust info without forwarding to agent', () => {
    const systems: string[] = [];
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
    });

    handler('/trust');

    expect(systems.at(-1)).toContain('Extension Trust');
    expect(systems.at(-1)).toContain('Allow Untrusted:');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/trust opens the project trust overlay when available', () => {
    const openProjectTrust = vi.fn();
    const { handler, sendMessage } = makeHandler({
      uiOverlays: {
        openModelPicker: () => {},
        openAgentPicker: () => {},
        openSessionPicker: () => {},
        openSessionTree: () => {},
        openTranscriptTree: () => {},
        openUserMessageFork: () => {},
        openScopedModels: () => {},
        openThinkingSelector: () => {},
        openSettings: () => {},
        openProjectTrust,
        reloadKeybindings: () => {},
      },
    });

    handler('/trust');

    expect(openProjectTrust).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('opens built-in overlays without forwarding slash commands to the agent', () => {
    const overlayFns = {
      openModelPicker: vi.fn(),
      openAgentPicker: vi.fn(),
      openSessionPicker: vi.fn(),
      openSessionTree: vi.fn(),
      openTranscriptTree: vi.fn(),
      openUserMessageFork: vi.fn(),
      openScopedModels: vi.fn(),
      openThinkingSelector: vi.fn(),
      openSettings: vi.fn(),
      openProjectTrust: vi.fn(),
      reloadKeybindings: vi.fn(),
    };
    const { handler, sendMessage } = makeHandler({ uiOverlays: overlayFns });

    handler('/model claude');
    expect(overlayFns.openModelPicker).toHaveBeenCalledWith('claude');

    handler('/agents');
    expect(overlayFns.openAgentPicker).toHaveBeenCalledOnce();

    handler('/resume');
    handler('/sessions');
    expect(overlayFns.openSessionPicker).toHaveBeenCalledTimes(2);

    handler('/tree');
    expect(overlayFns.openTranscriptTree).toHaveBeenCalledOnce();

    handler('/fork');
    expect(overlayFns.openUserMessageFork).toHaveBeenCalledOnce();

    handler('/scoped-models');
    handler('/scopedmodels');
    expect(overlayFns.openScopedModels).toHaveBeenCalledTimes(2);

    handler('/think');
    expect(overlayFns.openThinkingSelector).toHaveBeenCalledOnce();

    handler('/settings');
    expect(overlayFns.openSettings).toHaveBeenCalledOnce();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports unavailable overlay commands instead of silently doing nothing', () => {
    const systems: string[] = [];
    const { handler, sendMessage } = makeHandler({
      uiOverlays: undefined,
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
    });

    handler('/resume');
    expect(systems.at(-1)).toContain('Session picker is not available');

    handler('/scoped-models');
    expect(systems.at(-1)).toContain('Scoped model picker is not available');

    handler('/settings');
    expect(systems.at(-1)).toContain('Settings are not available');

    handler('/reload');
    expect(systems.at(-1)).toContain('Reload is not available');

    handler('/think');
    expect(systems.at(-1)).toContain('Usage: /think');

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports unavailable optional command actions instead of silently doing nothing', () => {
    const systems: string[] = [];
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      recoverStream: undefined,
      retryLastMessage: undefined,
      copyLastAssistant: undefined,
      renameCurrentSession: undefined,
      switchModel: undefined,
      runCompaction: undefined,
      setThinkingLevel: undefined,
      setReasoningLevel: undefined,
      setVerboseLevel: undefined,
    });

    handler('/recover');
    expect(systems.at(-1)).toContain('Stream recovery is not available');

    handler('/retry');
    expect(systems.at(-1)).toContain('Retry is not available');

    handler('/copy');
    expect(systems.at(-1)).toContain('Copy is not available');

    handler('/name next');
    expect(systems.at(-1)).toContain('Session rename is not available');

    handler('/switch openai/gpt-5');
    expect(systems.at(-1)).toContain('Model switching is not available');

    handler('/compact');
    expect(systems.at(-1)).toContain('Compaction is not available');

    handler('/think high');
    expect(systems.at(-1)).toContain('Thinking level changes are not available');

    handler('/reasoning stream');
    expect(systems.at(-1)).toContain('Reasoning visibility changes are not available');

    handler('/verbose on');
    expect(systems.at(-1)).toContain('Verbose mode changes are not available');

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/login runs supported OAuth provider login locally', async () => {
    const runLogin = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({ runLogin });

    handler('/login anthropic');

    await vi.waitFor(() => expect(runLogin).toHaveBeenCalledWith('anthropic'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/login without provider opens the local provider picker', async () => {
    const runLogin = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({ runLogin });

    handler('/login');

    await vi.waitFor(() => expect(runLogin).toHaveBeenCalledWith(undefined));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/reload runs the TUI reload callback without forwarding to agent', async () => {
    const systems: string[] = [];
    const reloadKeybindings = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      uiOverlays: {
        openModelPicker: () => {},
        openAgentPicker: () => {},
        openSessionPicker: () => {},
        openSessionTree: () => {},
        openTranscriptTree: () => {},
        openUserMessageFork: () => {},
        openScopedModels: () => {},
        openThinkingSelector: () => {},
        openSettings: () => {},
        openProjectTrust: () => {},
        reloadKeybindings,
      },
    });

    handler('/reload');

    await vi.waitFor(() => expect(reloadKeybindings).toHaveBeenCalledOnce());
    expect(systems.at(-1)).toContain('Reloaded keybindings, TUI settings, theme, and extension UI.');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/logout lists and removes stored auth profiles without forwarding to agent', async () => {
    const systems: string[] = [];
    const profiles = [
      {
        profileId: 'openai:default',
        provider: 'openai',
        type: 'api_key' as const,
        hasKey: true,
      },
      {
        profileId: 'anthropic:user@example.com',
        provider: 'anthropic',
        type: 'oauth' as const,
        email: 'user@example.com',
        hasKey: true,
      },
    ];
    const remove = vi.fn(async () => true);
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
      authProfiles: {
        listAll: vi.fn(async () => profiles),
        listProvider: vi.fn(async (provider) => profiles.filter((profile) => profile.provider === provider)),
        remove,
        getStorePath: () => '/tmp/auth.json',
      },
    });

    handler('/logout');
    await vi.waitFor(() => expect(systems.at(-1)).toContain('Auth Profiles'));
    expect(systems.at(-1)).toContain('Use /logout <provider>');

    handler('/logout openai');
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('openai:default'));
    expect(systems.at(-1)).toContain('Logged out from openai');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/login shows auth setup guidance without forwarding to agent', () => {
    const systems: string[] = [];
    const { handler, sendMessage } = makeHandler({
      chatLog: {
        addSystem: (text: string) => systems.push(text),
        setToolsExpanded: () => {},
      } as never,
    });

    handler('/login anthropic');

    expect(systems.at(-1)).toContain('OAuth: /login anthropic');
    expect(systems.at(-1)).toContain('API key: xopc auth set anthropic <key>');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/import delegates import requests without forwarding to agent', async () => {
    let request: unknown;
    const { handler, sendMessage } = makeHandler({
      importSession: vi.fn(async (next) => {
        request = next;
      }),
    });

    handler('/import "my session.json" restored');
    await vi.waitFor(() => expect(request).toEqual({
      inputPath: 'my session.json',
      targetKey: 'restored',
    }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('/compact forwards custom compaction instructions', async () => {
    let instructions: string | undefined;
    const { handler, sendMessage } = makeHandler({
      runCompaction: vi.fn(async (next) => {
        instructions = next;
      }),
    });

    handler('/compact keep tool decisions and summarize old research');
    await vi.waitFor(() =>
      expect(instructions).toBe('keep tool decisions and summarize old research'),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('TUI share helpers', () => {
  it('parses share audience, mode, title, and description', () => {
    expect(
      parseTuiShareRequest('"out/site index.html" --public --zip -t "Site Zip" -d "review copy"'),
    ).toEqual({
      path: 'out/site index.html',
      audience: 'public',
      mode: 'force-zip',
      title: 'Site Zip',
      description: 'review copy',
    });
  });

  it('formats share results with reachability and routing details', () => {
    const text = formatTuiShareResult({
      kind: 'site',
      shareUrl: 'https://example.test/s/abc',
      title: 'Demo',
      thumbnailUrl: 'https://example.test/s/abc/thumbnail',
      reachability: 'local-only',
      reachabilityHint: 'Configure a tunnel for public access.',
      expiresAt: '2026-06-18T00:00:00.000Z',
      routingReason: 'single-html',
    });

    expect(text).toContain('Kind: site');
    expect(text).toContain('URL: https://example.test/s/abc');
    expect(text).toContain('Reachability: local-only');
    expect(text).toContain('Routing: single-html');
  });
});
