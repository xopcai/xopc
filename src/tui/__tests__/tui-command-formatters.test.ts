import { describe, expect, it } from 'vitest';

import { createXopcTuiKeybindingsManager } from '../tui-keybindings-file.js';
import {
  formatTuiCompactionResult,
  formatTuiConfigInfo,
  formatTuiChangelogInfo,
  formatTuiDebugInfo,
  formatTuiLoginInfo,
  formatTuiStoredAuthProfilesInfo,
  formatTuiContextInfo,
  formatTuiModelsInfo,
  formatTuiSessionListInfo,
  formatTuiSessionInfo,
  formatTuiSessionTreeInfo,
  formatTuiTranscriptTreeInfo,
  formatTuiTrustInfo,
  formatTuiUsageInfo,
  formatTuiWorkflowDetail,
  formatTuiWorkflowsInfo,
  parseTuiExportRequest,
  parseTuiImportRequest,
} from '../tui-command-formatters.js';
import { formatTuiStartText, getSlashCommands } from '../tui-commands.js';

describe('tui command formatters', () => {
it('exposes native usage and context commands', () => {
    const commands = getSlashCommands(true).map((command) => command.name);
    expect(commands).toContain('usage');
    expect(commands).toContain('context');
    expect(commands).toContain('model');
    expect(commands).toContain('clone');
    expect(commands).toContain('reasoning');
    expect(commands).toContain('verbose');
    expect(commands).toContain('config');
    expect(commands).toContain('export');
    expect(commands).toContain('import');
    expect(commands).toContain('btw');
    expect(commands).toContain('workflows');
    expect(commands).toContain('tree');
    expect(commands).toContain('changelog');
    expect(commands).toContain('login');
    expect(commands).toContain('logout');
    expect(commands).toContain('trust');
  });

  it('formats xopc extension trust policy', () => {
    const text = formatTuiTrustInfo({
      extensions: {
        enabled: ['demo'],
        disabled: ['old-demo'],
        security: {
          checkPermissions: true,
          allowUntrusted: false,
          allow: ['demo'],
          trackProvenance: true,
          allowPromptInjection: false,
        },
      },
    } as never, {
      configPath: '/tmp/xopc.json',
      provenance: [{ extensionId: 'demo', source: 'workspace', installMethod: 'manual' }],
    });

    expect(text).toContain('Extension Trust');
    expect(text).toContain('Project trust gates project-local xopc resources');
    expect(text).toContain('Project Trust: not saved');
    expect(text).toContain('Allow Untrusted: no');
    expect(text).toContain('Allowlist: demo');
    expect(text).toContain('demo — workspace, manual');
    expect(text).toContain('xopc extensions audit');
  });

  it('formats login guidance from provider metadata', () => {
    expect(formatTuiLoginInfo()).toContain('OAuth providers:');
    const text = formatTuiLoginInfo('anthropic');
    expect(text).toContain('anthropic — Anthropic');
    expect(text).toContain('OAuth: /login anthropic');
    expect(text).toContain('API key: xopc auth set anthropic <key>');
  });

  it('formats stored auth profile summaries', () => {
    const text = formatTuiStoredAuthProfilesInfo(
      [
        {
          profileId: 'openai:default',
          provider: 'openai',
          type: 'api_key',
          hasKey: true,
        },
        {
          profileId: 'anthropic:user@example.com',
          provider: 'anthropic',
          type: 'oauth',
          email: 'user@example.com',
          hasKey: true,
        },
      ],
      { authStorePath: '/tmp/auth.json' },
    );

    expect(text).toContain('Auth Profiles');
    expect(text).toContain('anthropic — anthropic:user@example.com');
    expect(text).toContain('openai — openai:default');
    expect(text).toContain('Use /logout <provider>');
    expect(text).toContain('Store: /tmp/auth.json');
  });

  it('formats changelog markdown for the TUI', () => {
    const text = formatTuiChangelogInfo(
      [
        '# Changelog',
        '',
        'Intro text',
        '',
        '## 0.0.102',
        '',
        '- Added TUI polish',
      ].join('\n'),
      '/repo/CHANGELOG.md',
    );

    expect(text).toContain("What's New");
    expect(text).toContain('## 0.0.102');
    expect(text).toContain('- Added TUI polish');
    expect(text).not.toContain('Intro text');
    expect(text).toContain('Source: /repo/CHANGELOG.md');
  });

  it('formats missing changelog state', () => {
    expect(formatTuiChangelogInfo('')).toBe("What's New\n\nNo changelog entries found.");
  });

  it('formats hidden debug snapshots with rendered line widths', () => {
    const text = formatTuiDebugInfo({
      state: {
        currentSessionKey: 'agent:main:main',
        sessionInfo: { model: 'gpt-5' },
        toolsExpanded: false,
        showThinking: true,
        messageFollowUpQueue: [],
        steeringQueue: [],
      } as never,
      terminal: { columns: 80, rows: 24 },
      renderedLines: ['plain', '\x1b[31mred\x1b[0m'],
      logStats: { byLevel: { info: 2 } },
    });

    expect(text).toContain('Terminal: 80x24');
    expect(text).toContain('"currentSessionKey": "agent:main:main"');
    expect(text).toContain('=== Runtime Log Stats ===');
    expect(text).toContain('[0] (w=5) "plain"');
    expect(text).toContain('(w=3)');
  });

  it('parses export command arguments', () => {
    expect(parseTuiExportRequest('')).toEqual({ format: 'html', outputPath: undefined });
    expect(parseTuiExportRequest('json')).toEqual({ format: 'json', outputPath: undefined });
    expect(parseTuiExportRequest('markdown out.md')).toEqual({
      format: 'markdown',
      outputPath: 'out.md',
    });
    expect(parseTuiExportRequest('"my session.json"')).toEqual({
      format: 'json',
      outputPath: 'my session.json',
    });
    expect(parseTuiExportRequest('notes.html')).toEqual({
      format: 'html',
      outputPath: 'notes.html',
    });
  });

  it('parses import command arguments', () => {
    expect(parseTuiImportRequest('')).toEqual({ inputPath: undefined, targetKey: undefined });
    expect(parseTuiImportRequest('session.json')).toEqual({
      inputPath: 'session.json',
      targetKey: undefined,
    });
    expect(parseTuiImportRequest('"my session.json" restored')).toEqual({
      inputPath: 'my session.json',
      targetKey: 'restored',
    });
  });

  it('formats current session status from local TUI state', () => {
    const text = formatTuiSessionInfo({
      currentSessionKey: 'agent:research:tui-123',
      activeRunId: null,
      isConnected: true,
      activityStatus: 'streaming',
      connectionStatus: 'ready',
      sessionInfo: {
        displayName: 'Focused work',
        modelProvider: 'openai',
        model: 'gpt-5',
        thinkingLevel: 'high',
        reasoningLevel: 'stream',
        verboseLevel: 'full',
        totalTokens: 42_000,
        contextWindow: 128_000,
      },
      autoMessageSent: false,
      historyLoaded: true,
      toolsExpanded: true,
      showThinking: true,
      lastCtrlCAt: 0,
      exitRequested: false,
      messageFollowUpQueue: ['next'],
      steeringQueue: ['queued steer'],
      scopedModelRefs: null,
      lastEscapeAt: 0,
      progressMessage: null,
      isCompacting: false,
      compactionQueue: [],
    });

    expect(text).toContain('Session Info');
    expect(text).toContain('Name: Focused work');
    expect(text).toContain('Key: agent:research:tui-123');
    expect(text).toContain('Agent: research');
    expect(text).toContain('Model: openai/gpt-5');
    expect(text).toContain('Reasoning: stream');
    expect(text).toContain('Verbose: full');
    expect(text).toContain('Context: 33%/128k ctx');
    expect(text).toContain('Queue: 1');
    expect(text).toContain('Steering Queue: 1');
  });

  it('formats usage and context details from local TUI state', () => {
    const state = {
      currentSessionKey: 'agent:main:main',
      activeRunId: null,
      isConnected: true,
      activityStatus: 'idle',
      connectionStatus: 'ready',
      sessionInfo: {
        modelProvider: 'anthropic',
        model: 'claude-sonnet-4',
        totalTokens: 64_000,
        contextWindow: 200_000,
      },
      autoMessageSent: false,
      historyLoaded: true,
      toolsExpanded: false,
      showThinking: false,
      lastCtrlCAt: 0,
      exitRequested: false,
      messageFollowUpQueue: [],
        steeringQueue: [],
      scopedModelRefs: null,
      lastEscapeAt: 0,
      progressMessage: null,
      isCompacting: false,
      compactionQueue: [],
    } as const;

    expect(formatTuiUsageInfo(state)).toContain('Context Usage: 32%/200k ctx');
    expect(formatTuiUsageInfo(state)).toContain('Model: anthropic/claude-sonnet-4');
    expect(
      formatTuiUsageInfo(state, {
        totalMessages: 4,
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 2,
        toolResults: 1,
        contextRows: 1,
        tokens: { input: 120, output: 34, cacheRead: 10, cacheWrite: 5, total: 169 },
      }),
    ).toContain('Input: 120');
    expect(
      formatTuiSessionInfo(state, {
        totalMessages: 4,
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 2,
        toolResults: 1,
        contextRows: 1,
        tokens: { input: 120, output: 34, cacheRead: 10, cacheWrite: 5, total: 169 },
      }),
    ).toContain('Tool Calls: 2');
    expect(
      formatTuiSessionInfo(state, {
        totalMessages: 4,
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 2,
        toolResults: 1,
        contextRows: 1,
        tokens: { input: 120, output: 34, cacheRead: 10, cacheWrite: 5, total: 169 },
      }),
    ).toContain('Cache Read: 10');
    expect(formatTuiContextInfo(state)).toContain('Remaining: 136,000');
    expect(formatTuiContextInfo(state)).toContain('Usage: 32%/200k ctx');
  });

  it('formats compaction results with summary details', () => {
    const text = formatTuiCompactionResult({
      compacted: true,
      summary: 'Compacted (9,000 -> 1,200 tokens)',
      tokensBefore: 9000,
      tokensAfter: 1200,
      transcriptSummary: 'Kept final implementation decisions and open risks.',
    });

    expect(text).toContain('[compaction]');
    expect(text).toContain('Tokens: 9,000 -> 1,200');
    expect(text).toContain('Kept final implementation decisions and open risks.');
    expect(formatTuiCompactionResult({ compacted: false })).toBe('Nothing to compact');
  });

  it('formats a local config summary', () => {
    const text = formatTuiConfigInfo({
      currentSessionKey: 'agent:main:main',
      activeRunId: null,
      isConnected: true,
      activityStatus: 'idle',
      connectionStatus: 'ready',
      sessionInfo: {
        modelProvider: 'openai',
        model: 'gpt-5',
        thinkingLevel: 'high',
        reasoningLevel: 'stream',
        verboseLevel: 'full',
      },
      autoMessageSent: false,
      historyLoaded: true,
      toolsExpanded: true,
      showThinking: false,
      lastCtrlCAt: 0,
      exitRequested: false,
      messageFollowUpQueue: [],
        steeringQueue: [],
      scopedModelRefs: ['openai/gpt-5'],
      lastEscapeAt: 0,
      progressMessage: null,
      isCompacting: false,
      compactionQueue: [],
    });

    expect(text).toContain('Model: openai/gpt-5');
    expect(text).toContain('Thinking: high');
    expect(text).toContain('Reasoning: stream');
    expect(text).toContain('Verbose: full');
    expect(text).toContain('Scoped Models: openai/gpt-5');
  });

  it('formats startup help text', () => {
    const text = formatTuiStartText(
      {
        currentSessionKey: 'agent:main:main',
        activeRunId: null,
        isConnected: true,
        activityStatus: 'idle',
        connectionStatus: 'ready',
        sessionInfo: { modelProvider: 'openai', model: 'gpt-5' },
        autoMessageSent: false,
        historyLoaded: true,
        toolsExpanded: false,
        showThinking: false,
        lastCtrlCAt: 0,
        exitRequested: false,
        messageFollowUpQueue: [],
        steeringQueue: [],
        scopedModelRefs: null,
        lastEscapeAt: 0,
        progressMessage: null,
        isCompacting: false,
        compactionQueue: [],
      },
      true,
      createXopcTuiKeybindingsManager(),
    );

    expect(text).toContain('xopc TUI');
    expect(text).toContain('Session: agent:main:main');
    expect(text).toContain('Model: openai/gpt-5');
    expect(text).toContain('/export');
  });

  it('formats available model choices', () => {
    const text = formatTuiModelsInfo([
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
      { provider: 'anthropic', id: 'claude-sonnet-4', name: 'claude-sonnet-4' },
    ]);

    expect(text).toContain('openai/gpt-5 — GPT-5');
    expect(text).toContain('anthropic/claude-sonnet-4');
  });

  it('formats workflow lists and details', () => {
    const list = formatTuiWorkflowsInfo([
      {
        name: 'audit_repo',
        source: 'builtin',
        path: null,
        description: 'Audit a repository',
        tags: ['code'],
      },
    ]);
    expect(list).toContain('audit_repo (builtin) [code]');
    expect(list).toContain('Audit a repository');

    const detail = formatTuiWorkflowDetail('audit_repo');
    expect(detail).toContain('Workflow: audit_repo');
    expect(detail).toContain('Script:');
  });

  it('formats a compact session list with the current session marked', () => {
    const now = Date.now();
    const text = formatTuiSessionListInfo(
      [
        {
          key: 'agent:main:main',
          displayName: 'Main',
          updatedAt: now,
          messageCount: 4,
          totalTokens: 1200,
          model: 'openai/gpt-5',
        },
        {
          key: 'agent:main:tui-2',
          updatedAt: now - 120_000,
          messageCount: 1,
        },
      ],
      { currentSessionKey: 'agent:main:main', limit: 1 },
    );

    expect(text).toContain('* Main');
    expect(text).toContain('4 msgs');
    expect(text).toContain('openai/gpt-5');
    expect(text).toContain('agent:main:main');
    expect(text).toContain('Showing 1 of 2 sessions');
  });

  it('formats a grouped session tree', () => {
    const now = Date.now();
    const text = formatTuiSessionTreeInfo(
      [
        {
          key: 'agent:main:main',
          displayName: 'Main',
          updatedAt: now,
          messageCount: 4,
        },
        {
          key: 'agent:main:telegram:direct:alice',
          displayName: 'Alice fork',
          updatedAt: now - 120_000,
          messageCount: 2,
          forkedFromSessionKey: 'agent:main:main',
        },
        {
          key: 'legacy-session',
          updatedAt: now,
        },
      ],
      { currentSessionKey: 'agent:main:main' },
    );

    expect(text).toContain('Session Tree');
    expect(text).toContain('main/main');
    expect(text).toContain('* Main');
    expect(text).toContain('main/telegram');
    expect(text).toContain('forked from Main');
    expect(text).toContain('legacy/legacy-session');
  });

  it('formats a transcript tree', () => {
    const text = formatTuiTranscriptTreeInfo([
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        userLabel: 'important',
        turn: 1,
        preview: 'Plan this change',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: 'Implementation details',
      },
      {
        id: 'row-3',
        parentId: 'row-1',
        depth: 1,
        label: 'user',
        role: 'user',
        turn: 2,
        preview: 'Branch prompt',
      },
      {
        id: 'row-4',
        parentId: 'row-3',
        depth: 2,
        label: 'assistant',
        role: 'assistant',
        isOnActivePath: true,
        turn: 2,
        preview: 'Branch answer',
      },
      {
        id: 'row-5',
        parentId: 'row-1',
        depth: 1,
        label: 'model_change',
        turn: 2,
        preview: 'openai/gpt-5',
      },
      {
        id: 'row-6',
        parentId: 'row-1',
        depth: 1,
        label: 'tool:read_file',
        role: 'toolResult',
        turn: 2,
        preview: 'file contents',
      },
      {
        id: 'row-7',
        parentId: 'row-1',
        depth: 1,
        label: 'bashExecution',
        role: 'bashExecution',
        turn: 2,
        preview: 'pnpm test',
      },
    ]);

    expect(text).toContain('Transcript Tree');
    expect(text).toContain('- #1 [important] user: Plan this change');
    expect(text).toContain('  ├─ #1 assistant: Implementation details');
    expect(text).toContain('  ├─ #2 user: Branch prompt');
    expect(text).toContain('  │  └─ • #2 assistant: Branch answer');
    expect(text).toContain('  ├─ #2 [model: gpt-5]');
    expect(text).toContain('  ├─ #2 [read_file]');
    expect(text).toContain('  └─ #2 [bash]: pnpm test');
    expect(text).toContain('Interactive /tree supports search, filters, folds, labels, and fork selection.');
  });

  it('formats filtered transcript tree rows against their nearest visible ancestor', () => {
    const allEntries = [
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'Root prompt',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'context',
        turn: 1,
        preview: 'hidden context',
      },
      {
        id: 'row-3',
        parentId: 'row-2',
        depth: 2,
        label: 'assistant',
        role: 'assistant',
        turn: 1,
        preview: 'Visible answer',
      },
    ];
    const text = formatTuiTranscriptTreeInfo([allEntries[0]!, allEntries[2]!], { allEntries });

    expect(text).toContain('- #1 user: Root prompt');
    expect(text).toContain('  └─ #1 assistant: Visible answer');
  });

  it('formats transcript tree rows with hidden parents as text roots', () => {
    const allEntries = [
      {
        id: 'row-1',
        depth: 0,
        label: 'user',
        role: 'user',
        turn: 1,
        preview: 'Root prompt',
      },
      {
        id: 'row-2',
        parentId: 'row-1',
        depth: 1,
        label: 'assistant',
        role: 'assistant',
        userLabel: 'important',
        turn: 1,
        preview: 'Only visible child',
      },
    ];
    const text = formatTuiTranscriptTreeInfo([allEntries[1]!], { allEntries });

    expect(text).toContain('- #1 [important] assistant: Only visible child');
  });
});
