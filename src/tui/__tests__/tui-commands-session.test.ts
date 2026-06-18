import { describe, expect, it, vi } from 'vitest';

import { ChatLog } from '../components/chat-log.js';
import {
  createTuiCommandHandler,
  formatTuiShareResult,
  parseTuiShareRequest,
} from '../tui-commands.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { createInitialState } from '../tui-types.js';
import { StreamAssembler } from '../stream-assembler.js';

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
    assembler: new StreamAssembler(),
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

  it('/clear aliases /reset', async () => {
    const { handler, resetSession } = makeHandler();
    handler('/clear');
    await vi.waitFor(() => expect(resetSession).toHaveBeenCalledOnce());
  });

  it('/fork calls forkSession and does not forward slash to agent', async () => {
    const forkSession = vi.fn(async () => {});
    const { handler, sendMessage } = makeHandler({ forkSession });
    handler('/fork custom-fork');
    await vi.waitFor(() => expect(forkSession).toHaveBeenCalledWith('custom-fork'));
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
        openSessionPicker: () => {},
        openSessionTree: () => {},
        openTranscriptTree: () => {},
        openUserMessageFork: () => {},
        openScopedModels: () => {},
        openThinkingSelector: () => {},
        openSettings: () => {},
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

    expect(systems.at(-1)).toContain('OAuth: xopc auth login anthropic');
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
