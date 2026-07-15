import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  AssistantMessageComponent,
  createAssistantMessageFromText,
} from '../components/assistant-message.js';

function stripAnsi(text: string): string {
  return text
    .replace(/][^]*/g, '')
    .replace(/\[[0-9;]*m/g, '');
}

function assistantMessage(content: unknown, extra: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: 'assistant',
    content,
    timestamp: 1,
    ...extra,
  } as AgentMessage;
}

describe('assistant message rendering', () => {
  it('wraps rendered assistant text in OSC 133 zone markers', () => {
    const component = new AssistantMessageComponent(createAssistantMessageFromText('answer'));
    const rendered = component.render(80);
    expect(rendered[0]).toContain('\x1b]133;A\x07');
    expect(rendered[rendered.length - 1]).toContain('\x1b]133;B\x07\x1b]133;C\x07');
  });

  it('preserves ordered list markers in assistant markdown', () => {
    const component = new AssistantMessageComponent(createAssistantMessageFromText('3. third\n7. seventh'));
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('3. third');
    expect(rendered).toContain('7. seventh');
  });

  it('renders structured text blocks and ignores tool calls as visible content', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        { type: 'text', text: 'structured answer' },
        { type: 'toolCall', id: 'tc1', name: 'search', arguments: {} },
      ]),
    );
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('structured answer');
    expect(rendered).not.toContain('search');
  });

  it('does not render assistant rows that only contain tool calls', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([{ type: 'toolCall', id: 'tc1', name: 'read_file', arguments: {} }]),
    );
    expect(component.render(80)).toEqual([]);
  });

  it('renders thinking, text, and image blocks in source order', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        { type: 'text', text: 'first' },
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'second' },
        { type: 'image' },
      ]),
    );
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered.indexOf('first')).toBeLessThan(rendered.indexOf('plan'));
    expect(rendered.indexOf('plan')).toBeLessThan(rendered.indexOf('second'));
    expect(rendered).toContain('[image]');
  });

  it('renders review blocks', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        {
          type: 'review',
          target: 'working tree changes',
          summary: '1 finding',
          findings: [
            {
              title: 'Prefer persisted details',
              body: 'The renderer should read structured details.',
              priority: 2,
              filePath: 'src/session.ts',
              lineStart: 10,
              lineEnd: 12,
            },
          ],
          overallCorrectness: 'patch is incorrect',
          overallExplanation: 'A persisted field is ignored.',
        },
      ]),
    );
    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('Code review');
    expect(rendered).toContain('[P2] Prefer persisted details - src/session.ts:10-12');
    expect(rendered).toContain('Overall correctness: patch is incorrect');
  });

  it('does not render local fallback reviews as no findings', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        {
          type: 'review',
          target: 'working tree changes',
          summary: 'Review model did not complete; returned a local diff summary.',
          findings: [],
          overallCorrectness: 'unknown',
          overallExplanation: 'Reviewer model error: missing API key.',
          source: 'local',
        },
      ]),
    );
    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('No model findings were produced.');
    expect(rendered).not.toContain('No findings.');
  });

  it('can hide structured assistant thinking behind a label and toggle it back', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        { type: 'thinking', thinking: 'private plan' },
        { type: 'text', text: 'answer' },
      ]),
      { hideThinkingBlock: true },
    );

    const hidden = stripAnsi(component.render(80).join('\n'));
    expect(hidden).toContain('Thinking...');
    expect(hidden).toContain('answer');
    expect(hidden).not.toContain('private plan');

    component.setHideThinkingBlock(false);
    expect(stripAnsi(component.render(80).join('\n'))).toContain('private plan');
  });

  it('does not add OSC 133 markers when content includes tool calls', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        { type: 'text', text: 'calling tool' },
        { type: 'toolCall', id: 'tc1', name: 'read_file', arguments: {} },
      ]),
    );
    const rendered = component.render(80).join('\n');
    expect(rendered).toContain('calling tool');
    expect(rendered).not.toContain('\x1b]133;A\x07');
    expect(rendered).not.toContain('\x1b]133;B\x07');
    expect(rendered).not.toContain('\x1b]133;C\x07');
  });

  it('hides mechanical patch summaries when linked to tool calls', () => {
    const component = new AssistantMessageComponent(
      createAssistantMessageFromText('• Added src/agent/session/__tests__/session-inspector.test.ts (+38 -0)'),
    );
    component.setHasToolCalls(true);

    expect(component.render(100)).toEqual([]);
  });

  it('keeps explanatory text while removing linked mechanical summary lines', () => {
    const component = new AssistantMessageComponent(
      createAssistantMessageFromText([
        'Implemented the focused SessionInspector coverage.',
        '• Added src/agent/session/__tests__/session-inspector.test.ts (+38 -0)',
        'The test uses mocks and does not touch a real database.',
      ].join('\n')),
    );
    component.setHasToolCalls(true);

    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('Implemented the focused SessionInspector coverage.');
    expect(rendered).toContain('The test uses mocks');
    expect(rendered).not.toContain('(+38 -0)');
  });

  it('does not compact mechanical-looking text without linked tool calls', () => {
    const component = new AssistantMessageComponent(
      createAssistantMessageFromText('• Added docs/notes.md (+2 -0)'),
    );

    const rendered = stripAnsi(component.render(100).join('\n'));
    expect(rendered).toContain('Added docs/notes.md (+2 -0)');
  });

  it('treats tool_use blocks as tool calls for assistant zone handling', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([
        { type: 'text', text: 'calling tool' },
        { type: 'tool_use', id: 'tc1', name: 'read', input: {} },
      ]),
    );
    const rendered = component.render(80).join('\n');
    expect(rendered).toContain('calling tool');
    expect(rendered).not.toContain('\x1b]133;A\x07');
    expect(rendered).not.toContain('tool_use');
  });

  it('renders assistant error state inside the assistant message', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([{ type: 'text', text: 'partial answer' }], {
        stopReason: 'error',
        errorMessage: 'model failed',
      }),
    );
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('partial answer');
    expect(rendered).toContain('Error: model failed');
  });

  it('renders assistant aborted state with pi-style default text', () => {
    const component = new AssistantMessageComponent(
      assistantMessage([], {
        stopReason: 'aborted',
        errorMessage: 'Request was aborted',
      }),
    );
    expect(stripAnsi(component.render(80).join('\n'))).toContain('Operation aborted');
  });
});
