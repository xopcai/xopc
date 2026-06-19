import { describe, expect, it, vi } from 'vitest';
import { Text } from '@earendil-works/pi-tui';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import {
  clearTuiToolRenderers,
  registerTuiToolRenderer,
  renderToolWithExtensions,
} from '../extension-host/tool-renderers.js';
import { ChatLog } from '../components/chat-log.js';
import { BranchSummaryComponent } from '../components/branch-summary.js';
import { CompactionSummaryComponent } from '../components/compaction-summary.js';
import {
  getToolResultDisplayText,
  ToolExecutionComponent,
} from '../components/tool-execution.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function tool(
  toolName: string,
  args: unknown,
  options?: ConstructorParameters<typeof ToolExecutionComponent>[3],
  toolCallId = 'test-tool-call',
): ToolExecutionComponent {
  return new ToolExecutionComponent(toolName, toolCallId, args, options);
}

function assistantMessage(content: unknown): AgentMessage {
  return { role: 'assistant', content, timestamp: 1 } as AgentMessage;
}

function makeToolRenderContext(overrides: Partial<Parameters<typeof renderToolWithExtensions>[0]> = {}) {
  return {
    toolName: 'custom_tool',
    toolCallId: 'call-1',
    args: {},
    resultText: '',
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: '/tmp/work',
    executionStarted: true,
    argsComplete: true,
    isError: false,
    isPartial: false,
    expanded: false,
    showImages: true,
    ...overrides,
  };
}

describe('tui tool renderers', () => {
  it('tracks the latest assistant text for clipboard copy', () => {
    const chatLog = new ChatLog();
    expect(chatLog.getLastAssistantText()).toBe('');

    chatLog.finalizeAssistant(assistantMessage([{ type: 'text', text: 'first' }]), 'r1');
    expect(chatLog.getLastAssistantText()).toBe('first');

    chatLog.startAssistant(assistantMessage([{ type: 'text', text: 'draft' }]), 'r2');
    chatLog.updateAssistant(assistantMessage([{ type: 'text', text: 'final draft' }]), 'r2');
    expect(chatLog.getLastAssistantText()).toBe('final draft');

    chatLog.clearAll();
    expect(chatLog.getLastAssistantText()).toBe('');
  });

  it('coalesces consecutive transient status messages', () => {
    const chatLog = new ChatLog();
    chatLog.addStatus('first status');
    chatLog.addStatus('second status');

    const rendered = chatLog.render(100).join('\n');
    expect(rendered).toContain('second status');
    expect(rendered).not.toContain('first status');
  });

  it('starts a new transient status after normal chat content', () => {
    const chatLog = new ChatLog();
    chatLog.addStatus('first status');
    chatLog.addUser('hello');
    chatLog.addStatus('second status');

    const rendered = chatLog.render(100).join('\n');
    expect(rendered).toContain('first status');
    expect(rendered).toContain('hello');
    expect(rendered).toContain('second status');
  });

  it('uses registered custom message renderers and propagates expanded state', () => {
    const chatLog = new ChatLog();
    const seenContent: unknown[] = [];
    chatLog.setCustomMessageRenderer('status-update', (message, options) => {
      seenContent.push(message.content);
      const content = Array.isArray(message.content) ? 'raw-blocks' : message.content;
      return new Text(`custom:${content}:${options.expanded}`, 0, 0);
    });

    chatLog.addCustomMessage({
      customType: 'status-update',
      content: 'fallback',
      rawContent: [{ type: 'text', text: 'ready' }],
    });

    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('custom:raw-blocks:false');
    chatLog.setToolsExpanded(true);
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('custom:raw-blocks:true');
    expect(seenContent[0]).toEqual([{ type: 'text', text: 'ready' }]);
  });

  it('refreshes existing custom messages when renderers are registered or removed', () => {
    const chatLog = new ChatLog();
    chatLog.addCustomMessage({
      customType: 'status-update',
      content: 'fallback content',
    });

    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('[status-update]');
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('fallback content');

    chatLog.setCustomMessageRenderer('status-update', (message) =>
      new Text(`custom:${message.content}`, 0, 0));
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('custom:fallback content');
    expect(stripAnsi(chatLog.render(100).join('\n'))).not.toContain('[status-update]');

    chatLog.setCustomMessageRenderer('status-update', undefined);
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('[status-update]');
    expect(stripAnsi(chatLog.render(100).join('\n'))).toContain('fallback content');
  });

  it('updates hidden thinking labels on existing assistant messages', () => {
    const chatLog = new ChatLog();
    chatLog.setShowThinking(false);
    chatLog.finalizeAssistant(
      assistantMessage([
        { type: 'thinking', thinking: 'private plan' },
        { type: 'text', text: 'answer' },
      ]),
      'run-1',
    );
    chatLog.setHiddenThinkingLabel('Planning...');

    const rendered = chatLog.render(100).join('\n');
    expect(rendered).toContain('Planning...');
    expect(rendered).toContain('answer');
    expect(rendered).not.toContain('private plan');
  });

  it('invokes extension renderer for matching tool names', () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('custom_tool', (ctx) => [
      `custom:${ctx.toolName}:${ctx.resultText}`,
    ]);
    const rendered = renderToolWithExtensions(makeToolRenderContext({
      toolName: 'custom_tool',
      args: {},
      resultText: 'done',
      expanded: true,
    }));
    expect(rendered).toEqual(['custom:custom_tool:done']);
    clearTuiToolRenderers();
  });

  it('passes structured tool result fields to extension renderers', () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('workflow', (ctx) => [
      `partial:${ctx.isPartial === true}`,
      `details:${JSON.stringify(ctx.details)}`,
      `content:${ctx.content?.[0]?.text ?? ''}`,
    ]);

    const component = tool('workflow', {});
    component.setPartialDetails({ phase: 'build', status: 'running' });
    expect(component.render(80).join('\n')).toContain(
      'details:{"phase":"build","status":"running"}',
    );

    component.updateResult(
      JSON.stringify({
        content: [{ type: 'text', text: 'done' }],
        details: { phase: 'build', status: 'done' },
      }),
      false,
    );
    const rendered = component.render(80).join('\n');
    expect(rendered).toContain('partial:false');
    expect(rendered).toContain('details:{"phase":"build","status":"done"}');
    expect(rendered).toContain('content:done');
    clearTuiToolRenderers();
  });

  it('passes pi-style per-row tool renderer context fields', () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('workflow', (ctx) => {
      const count = Number(ctx.state.count ?? 0) + 1;
      ctx.state.count = count;
      const last = Array.isArray(ctx.lastComponent) ? ctx.lastComponent[0] : 'none';
      return [
        `id:${ctx.toolCallId}`,
        `cwd:${ctx.cwd}`,
        `showImages:${ctx.showImages}`,
        `started:${ctx.executionStarted}`,
        `argsComplete:${ctx.argsComplete}`,
        `state:${count}`,
        `last:${last}`,
      ];
    });

    const component = tool(
      'workflow',
      { step: 'build' },
      { cwd: '/repo', showImages: false },
      'tc-42',
    );
    expect(stripAnsi(component.render(100).join('\n'))).toContain('state:1');

    component.markExecutionStarted();
    component.updateResult('done', false);
    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('id:tc-42');
    expect(rendered).toContain('cwd:/repo');
    expect(rendered).toContain('showImages:false');
    expect(rendered).toContain('started:true');
    expect(rendered).toContain('argsComplete:true');
    expect(rendered).toContain('state:3');
    expect(rendered).toContain('last:id:tc-42');
    clearTuiToolRenderers();
  });

  it('supports component-returning tool renderers and tracks the last component', () => {
    clearTuiToolRenderers();
    const seenLastComponents: unknown[] = [];
    registerTuiToolRenderer('workflow', (ctx) => {
      seenLastComponents.push(ctx.lastComponent);
      const count = Number(ctx.state.count ?? 0) + 1;
      ctx.state.count = count;
      return new Text(`component:${ctx.toolCallId}:${count}`, 0, 0);
    });

    const component = tool('workflow', {}, undefined, 'tc-component');
    expect(stripAnsi(component.render(100).join('\n'))).toContain('component:tc-component:1');

    component.updateResult('done', false);
    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('component:tc-component:2');
    expect(rendered).not.toContain('component:tc-component:1');
    expect(seenLastComponents[0]).toBeUndefined();
    expect(typeof (seenLastComponents[1] as { render?: unknown } | undefined)?.render).toBe('function');
    clearTuiToolRenderers();
  });

  it('supports pi-style structured tool call and result renderers', () => {
    clearTuiToolRenderers();
    const callLastComponents: unknown[] = [];
    const resultLastComponents: unknown[] = [];
    registerTuiToolRenderer('workflow', {
      renderCall(args, _theme, ctx) {
        callLastComponents.push(ctx.lastComponent);
        return new Text(`call:${ctx.toolCallId}:${JSON.stringify(args)}`, 0, 0);
      },
      renderResult(result, options, _theme, ctx) {
        resultLastComponents.push(ctx.lastComponent);
        return [
          `result:${ctx.toolCallId}:${result.text}`,
          `expanded:${options.expanded}`,
          `partial:${options.isPartial}`,
          `details:${JSON.stringify(result.details)}`,
        ];
      },
    });

    const component = tool(
      'workflow',
      { step: 'build' },
      undefined,
      'tc-structured',
    );
    expect(stripAnsi(component.render(100).join('\n'))).toContain(
      'call:tc-structured:{"step":"build"}',
    );
    expect(stripAnsi(component.render(100).join('\n'))).not.toContain('result:');

    component.setExpanded(true);
    component.updateResult(
      JSON.stringify({
        content: [{ type: 'text', text: 'done' }],
        details: { phase: 'build' },
      }),
      false,
    );

    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('call:tc-structured:{"step":"build"}');
    expect(rendered).toContain('result:tc-structured:done');
    expect(rendered).toContain('expanded:true');
    expect(rendered).toContain('partial:false');
    expect(rendered).toContain('details:{"phase":"build"}');
    expect(callLastComponents[0]).toBeUndefined();
    expect(typeof (callLastComponents[1] as { render?: unknown } | undefined)?.render).toBe('function');
    expect(resultLastComponents[0]).toBeUndefined();
    clearTuiToolRenderers();
  });

  it('lets tool renderers invalidate their own row', async () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('workflow', (ctx) => {
      if (!ctx.state.ready) {
        ctx.state.ready = true;
        ctx.invalidate();
        return ['pending'];
      }
      return ['ready'];
    });

    const component = tool('workflow', {}, undefined, 'tc-1');
    expect(stripAnsi(component.render(80).join('\n'))).toContain('pending');
    await vi.waitFor(() => {
      expect(stripAnsi(component.render(80).join('\n'))).toContain('ready');
    });
    clearTuiToolRenderers();
  });

  it('falls back to the default tool view when an extension renderer throws', () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('workflow', () => {
      throw new Error('renderer failed');
    });

    const component = tool('workflow', { step: 'build' });
    component.updateResult('completed', false);

    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('workflow');
    expect(rendered).toContain('step=build');
    expect(rendered).toContain('preview');
    expect(rendered).not.toContain('renderer failed');
    clearTuiToolRenderers();
  });

  it('renders unusual tool argument values without throwing', () => {
    const component = tool('debug_tool', {
      id: 1n,
      skip: undefined,
      callback: () => 'ok',
      marker: Symbol('mark'),
    });

    const rendered = component.render(160).join('\n');
    expect(rendered).toContain('id=1n');
    expect(rendered).toContain('skip=undefined');
    expect(rendered).toContain('callback=[function]');
    expect(rendered).toContain('marker=Symbol(mark)');
  });

  it('renders compact labels for resource read tool arguments', () => {
    const skill = tool('read_file', {
      path: '/workspace/attio/SKILL.md',
      offset: 120,
      limit: 210,
    });
    const agents = tool('read_file', {
      file_path: '/workspace/AGENTS.md',
    });
    const unrelated = tool('share_file', {
      path: '/workspace/attio/SKILL.md',
    });

    const skillRendered = skill.render(160).join('\n');
    expect(skillRendered).toContain('[skill] attio:120-329');
    expect(skillRendered).not.toContain('path=/workspace/attio/SKILL.md');

    const agentsRendered = agents.render(160).join('\n');
    expect(agentsRendered).toContain('read resource /workspace/AGENTS.md');
    expect(agentsRendered).not.toContain('file_path=/workspace/AGENTS.md');

    const unrelatedRendered = unrelated.render(160).join('\n');
    expect(unrelatedRendered).not.toContain('[skill] attio');
    expect(unrelatedRendered).toContain('path=/workspace/attio/SKILL.md');
  });

  it('suppresses image placeholders when inline images are shown', () => {
    const content = [
      { type: 'text', text: 'done' },
      { type: 'image', mimeType: 'image/png', data: 'abc' },
    ];

    expect(
      getToolResultDisplayText(content, {
        showImages: true,
        supportsInlineImages: true,
      }),
    ).toBe('done');
    expect(
      getToolResultDisplayText(content, {
        showImages: false,
        supportsInlineImages: true,
      }),
    ).toBe('done\n[image:image/png]');
  });

  it('keeps fallback text for unknown structured tool content blocks', () => {
    expect(
      getToolResultDisplayText(
        [
          { type: 'json', text: '{"ok":true}' },
          { type: 'artifact' },
        ],
        {
          showImages: true,
          supportsInlineImages: true,
        },
      ),
    ).toBe('{"ok":true}\n[artifact]');
  });

  it('trims trailing blank display lines from structured tool output', () => {
    expect(
      getToolResultDisplayText(
        [
          { type: 'text', text: 'one\ntwo\n\n' },
        ],
        {
          showImages: true,
          supportsInlineImages: true,
        },
      ),
    ).toBe('one\ntwo');
  });

  it('trims trailing blank display lines from expanded fallback output', () => {
    const component = tool('read_file', { path: 'notes.txt' });
    component.updateResult('one\ntwo\n\n', false);
    component.setExpanded(true);

    const rendered = component.render(80).join('\n');
    expect(rendered).toContain('one');
    expect(rendered).toContain('two');
    expect(rendered).not.toContain('two\n\n');
  });

  it('keeps read tool results compact until expanded', () => {
    clearTuiToolRenderers();
    const component = tool('read_file', { path: 'long.txt' });
    component.updateResult('hidden content', false);

    const collapsed = component.render(80).join('\n');
    expect(collapsed).toContain('read_file');
    expect(collapsed).toContain('long.txt');
    expect(collapsed).toContain('1 row; Ctrl+O to expand');
    expect(collapsed).not.toContain('hidden content');

    component.setExpanded(true);
    expect(component.render(80).join('\n')).toContain('hidden content');
  });

  it('counts collapsed read summaries by rendered rows', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = tool('read_file', { path: 'wrapped.txt' }, { keybindings });
    component.updateResult('x'.repeat(200), false);

    const rendered = component.render(30).join('\n');
    expect(rendered).toMatch(/\d+ rows; X to expand/);
    expect(rendered).not.toContain('xxxxxxxxxxxxxxxxxxxx');
  });

  it('limits collapsed non-read tool output by rendered rows', () => {
    clearTuiToolRenderers();
    const component = tool('search', { query: 'needle' });
    component.updateResult('x'.repeat(200), false);

    const rendered = component.render(30).join('\n');
    expect(rendered).toContain('preview');
    expect(rendered.split('\n').filter((line) => line.includes('xxxxx')).length).toBeLessThanOrEqual(4);
  });

  it('uses configured tool expand key in collapsed tool hints', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = tool('read_file', { path: 'long.txt' }, { keybindings });
    component.updateResult('line\n'.repeat(20), false);

    expect(component.render(80).join('\n')).toContain('X to expand');
  });

  it('shows expand hint when collapsed output is visually truncated by wrapping', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = tool('search', { query: 'needle' }, { keybindings });
    component.updateResult('x'.repeat(200), false);

    expect(component.render(30).join('\n')).toContain('X to expand');
  });

  it('passes image display options from chat log to tool blocks', () => {
    const chatLog = new ChatLog();
    chatLog.setToolImageOptions({ showImages: false, imageWidthCells: 80 });
    chatLog.startTool('tc1', 'image_tool', {}, 'r1');

    const tool = (chatLog as unknown as {
      toolById: Map<string, { showImages: boolean; imageWidthCells: number }>;
    }).toolById.get('tc1');

    expect(tool?.showImages).toBe(false);
    expect(tool?.imageWidthCells).toBe(80);
  });

  it('renders compaction summaries collapsed and expanded', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = new CompactionSummaryComponent(
      {
        compacted: true,
        tokensBefore: 9000,
        tokensAfter: 1200,
        transcriptSummary: '## Summary\n\n- Kept final decisions',
      },
      keybindings,
    );

    const collapsed = component.render(100).join('\n');
    expect(collapsed).toContain('[compaction]');
    expect(collapsed).toContain('9,000 -> 1,200');
    expect(collapsed).toContain('X to expand summary');
    expect(collapsed).not.toContain('Kept final decisions');

    component.setExpanded(true);
    expect(component.render(100).join('\n')).toContain('Kept final decisions');
  });

  it('propagates tool expansion to compaction summaries in chat log', () => {
    const chatLog = new ChatLog(new XopcKeybindingsManager({ 'app.tools.expand': 'x' }));
    chatLog.addCompactionSummary({
      compacted: true,
      tokensBefore: 9000,
      tokensAfter: 1200,
      transcriptSummary: '- Full summary',
    });

    expect(chatLog.render(100).join('\n')).not.toContain('Full summary');
    chatLog.setToolsExpanded(true);
    expect(chatLog.render(100).join('\n')).toContain('Full summary');
  });

  it('renders branch summaries collapsed and expanded', () => {
    const keybindings = new XopcKeybindingsManager({ 'app.tools.expand': 'x' });
    const component = new BranchSummaryComponent(
      {
        sourceSessionKey: 'agent:main:main',
        targetSessionKey: 'agent:main:fork-1',
        rowCount: 12,
        entryId: 'row-4',
        restoredText: 'Continue from here',
      },
      keybindings,
    );

    const collapsed = component.render(100).join('\n');
    expect(collapsed).toContain('[branch]');
    expect(collapsed).toContain('12 rows');
    expect(collapsed).toContain('X to expand');
    expect(collapsed).not.toContain('Continue from here');

    component.setExpanded(true);
    const expanded = component.render(100).join('\n');
    expect(expanded).toContain('agent:main:main');
    expect(expanded).toContain('agent:main:fork-1');
    expect(expanded).toContain('Continue from here');
  });

  it('propagates tool expansion to branch summaries in chat log', () => {
    const chatLog = new ChatLog(new XopcKeybindingsManager({ 'app.tools.expand': 'x' }));
    chatLog.addBranchSummary({
      sourceSessionKey: 'agent:main:main',
      targetSessionKey: 'agent:main:fork-1',
      rowCount: 3,
      restoredText: 'branch input',
    });

    expect(chatLog.render(100).join('\n')).not.toContain('branch input');
    chatLog.setToolsExpanded(true);
    expect(chatLog.render(100).join('\n')).toContain('branch input');
  });
});
