import { describe, expect, it } from 'vitest';

import {
  AssistantMessageComponent,
  normalizeAssistantContent,
  __testing as assistantMessageTesting,
} from '../components/assistant-message.js';

function stripAnsi(text: string): string {
  return text
    .replace(/][^]*/g, '')
    .replace(/[[0-9;]*m/g, '');
}

describe('assistant message rendering', () => {
  it('normalizes structured assistant content blocks for display', () => {
    expect(
      normalizeAssistantContent([
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'answer' },
        { type: 'image' },
        { type: 'toolCall', name: 'read_file' },
      ]),
    ).toBe('<thinking>\nplan\n</thinking>\n\nanswer\n\n[image]');
  });

  it('splits leading thinking block from assistant content', () => {
    expect(
      assistantMessageTesting.splitThinkingBlock('<thinking>\nplan\n</thinking>\n\nanswer'),
    ).toEqual({ thinking: 'plan', content: 'answer' });
  });

  it('splits multiple thinking blocks while preserving content order', () => {
    expect(
      assistantMessageTesting.splitAssistantContentSegments(
        'first\n\n<thinking>\nplan\n</thinking>\n\nsecond\n\n<thinking>\ncheck\n</thinking>',
      ),
    ).toEqual([
      { type: 'text', text: 'first' },
      { type: 'thinking', text: 'plan' },
      { type: 'text', text: 'second' },
      { type: 'thinking', text: 'check' },
    ]);
  });

  it('wraps rendered assistant content in OSC 133 zone markers', () => {
    const component = new AssistantMessageComponent('answer');
    const rendered = component.render(80);
    expect(rendered[0]).toContain('\x1b]133;A\x07');
    expect(rendered[rendered.length - 1]).toContain('\x1b]133;B\x07\x1b]133;C\x07');
  });

  it('preserves ordered list markers in assistant markdown', () => {
    const component = new AssistantMessageComponent('3. third\n7. seventh');
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('3. third');
    expect(rendered).toContain('7. seventh');
  });

  it('renders structured assistant text content', () => {
    const component = new AssistantMessageComponent([
      { type: 'text', text: 'structured answer' },
      { type: 'toolCall', toolName: 'search' },
    ]);
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('structured answer');
    expect(rendered).not.toContain('[tool:search]');
  });

  it('does not render assistant rows that only contain tool calls', () => {
    const component = new AssistantMessageComponent([
      { type: 'toolCall', name: 'read_file' },
    ]);
    expect(component.render(80)).toEqual([]);
  });

  it('renders structured assistant thinking and text in source order', () => {
    const component = new AssistantMessageComponent([
      { type: 'text', text: 'first' },
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'second' },
    ]);
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered.indexOf('first')).toBeLessThan(rendered.indexOf('plan'));
    expect(rendered.indexOf('plan')).toBeLessThan(rendered.indexOf('second'));
  });

  it('can hide structured assistant thinking behind a label', () => {
    const component = new AssistantMessageComponent(
      [
        { type: 'thinking', thinking: 'private plan' },
        { type: 'text', text: 'answer' },
      ],
      { hideThinkingBlock: true },
    );

    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('Thinking...');
    expect(rendered).toContain('answer');
    expect(rendered).not.toContain('private plan');
  });

  it('toggles hidden assistant thinking dynamically', () => {
    const component = new AssistantMessageComponent('<thinking>\nprivate plan\n</thinking>\n\nanswer');

    expect(stripAnsi(component.render(80).join('\n'))).toContain('private plan');

    component.setHideThinkingBlock(true);
    const hidden = stripAnsi(component.render(80).join('\n'));
    expect(hidden).toContain('Thinking...');
    expect(hidden).not.toContain('private plan');

    component.setHideThinkingBlock(false);
    expect(stripAnsi(component.render(80).join('\n'))).toContain('private plan');
  });

  it('does not add OSC 133 markers when structured content includes tool calls', () => {
    const component = new AssistantMessageComponent([
      { type: 'text', text: 'calling tool' },
      { type: 'toolCall', name: 'read_file' },
    ]);
    const rendered = component.render(80).join('\n');
    expect(rendered).not.toContain('\x1b]133;A\x07');
    expect(rendered).not.toContain('\x1b]133;B\x07');
    expect(rendered).not.toContain('\x1b]133;C\x07');
  });

  it('treats tool_use blocks as tool calls for assistant zone handling', () => {
    const component = new AssistantMessageComponent([
      { type: 'text', text: 'calling tool' },
      { type: 'tool_use', name: 'read' },
    ]);
    const rendered = component.render(80).join('\n');
    expect(rendered).toContain('calling tool');
    expect(rendered).not.toContain('\x1b]133;A\x07');
    expect(rendered).not.toContain('tool_use');
  });

  it('renders assistant error state inside the assistant message', () => {
    const component = new AssistantMessageComponent('partial answer');
    component.setRenderState({ stopReason: 'error', errorMessage: 'model failed' });
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('partial answer');
    expect(rendered).toContain('Error: model failed');
  });

  it('renders assistant aborted state with pi-style default text', () => {
    const component = new AssistantMessageComponent('');
    component.setRenderState({ stopReason: 'aborted', errorMessage: 'Request was aborted' });
    expect(stripAnsi(component.render(80).join('\n'))).toContain('Operation aborted');
  });
});
