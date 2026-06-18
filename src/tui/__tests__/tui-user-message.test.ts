import { describe, expect, it } from 'vitest';

import { UserMessageComponent, normalizeUserContent } from '../components/user-message.js';

function stripAnsi(text: string): string {
  return text
    .replace(/][^]*/g, '')
    .replace(/[[0-9;]*m/g, '');
}

describe('user message rendering', () => {
  it('normalizes structured user content blocks for display', () => {
    expect(
      normalizeUserContent([
        { type: 'text', text: 'hello' },
        { type: 'image' },
        { type: 'input_text', text: 'from input' },
        { type: 'file', name: 'notes.pdf' },
        { type: 'custom', text: 'custom text' },
        { type: 'unknown' },
      ]),
    ).toBe('hello\n\n[image]\n\nfrom input\n\n[file:notes.pdf]\n\ncustom text\n\n[unknown]');
  });

  it('wraps rendered user content in OSC 133 zone markers', () => {
    const component = new UserMessageComponent('hello');
    const rendered = component.render(80);
    expect(rendered[0]).toContain('\x1b]133;A\x07');
    expect(rendered[rendered.length - 1]).toContain('\x1b]133;B\x07\x1b]133;C\x07');
  });

  it('renders user content in a stable padded box', () => {
    const component = new UserMessageComponent('hello');
    const rendered = component.render(20);
    expect(rendered).toHaveLength(3);
    expect(stripAnsi(rendered[1] ?? '')).toContain('hello');
    expect(rendered[0]).not.toContain('\x1b]133;B\x07');
    expect(rendered[2]?.startsWith('\x1b]133;B\x07\x1b]133;C\x07')).toBe(true);
  });

  it('preserves ordered list markers in user markdown', () => {
    const component = new UserMessageComponent('3. third\n7. seventh');
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('3. third');
    expect(rendered).toContain('7. seventh');
  });

  it('renders structured user text content', () => {
    const component = new UserMessageComponent([
      { type: 'text', text: 'structured user' },
      { type: 'input_image' },
    ]);
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('structured user');
    expect(rendered).toContain('[image]');
  });

  it('renders image names for attached user images', () => {
    const component = new UserMessageComponent([
      { type: 'text', text: 'look' },
      { type: 'image', name: 'clipboard-1.png' },
    ]);
    const rendered = stripAnsi(component.render(80).join('\n'));
    expect(rendered).toContain('look');
    expect(rendered).toContain('[image:clipboard-1.png]');
  });
});
