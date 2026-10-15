// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/messages';
import { ClarifyPrompt } from '../clarify-prompt';
vi.mock('@/features/chat/markdown/markdown-view', () => ({ MarkdownView: ({ content }: { content: string }) => <p>{content}</p> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const labels = messages('en').chat;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: ComponentProps<typeof ClarifyPrompt>;
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  props = { prompt: { requestId: 'q1', kind: 'input', question: 'Where?', choiceDetails: [{ id: 'stage', label: 'Stage', description: 'Test safely' }, { id: 'prod', label: 'Prod' }],
    recommendedChoiceId: 'stage', version: 1, createdAt: Date.now() }, submitting: false, submitError: null,
    labels, onSubmit: vi.fn(), onAgentDecide: vi.fn(), onCancel: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<ClarifyPrompt {...props} />));
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text))!; }
const click = (text: string) => act(async () => button(text).click());
async function type(text: string) {
  await act(async () => {
    const input = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
describe('clarify prompt', () => {
  it('keeps quick choices one click with no preselected recommendation', async () => {
    await render();
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(container.textContent).toContain('Test safely');
    await click('Stage');
    expect(props.onSubmit).toHaveBeenCalledWith({ response: { choiceId: 'stage' } });
  });
  it('submits selection and multiline details together, preserves drafts on refresh/error', async () => {
    props.prompt!.interactionMode = 'compose'; await render(); await click('Prod'); await type('After 22:00\nVerify first');
    expect(props.onSubmit).not.toHaveBeenCalled();
    props = { ...props, prompt: { ...props.prompt!, version: 2 }, submitError: 'Network failed' }; await render();
    expect(container.querySelector('textarea')!.value).toBe('After 22:00\nVerify first');
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe('Prod');
    await click(labels.clarifySend);
    expect(props.onSubmit).toHaveBeenCalledWith({ response: { choiceId: 'prod', text: 'After 22:00\nVerify first' } });
  });
  it('typing switches quick choices to selection and supports clearing to custom text', async () => {
    await render(); await type('My own answer'); await click('Prod'); expect(props.onSubmit).not.toHaveBeenCalled();
    await click(labels.clarifyClearChoice); await click(labels.clarifySend);
    expect(props.onSubmit).toHaveBeenCalledWith({ response: { choiceId: undefined, text: 'My own answer' } });
  });
  it('supports an explicit edit mode and resets state for another question', async () => {
    await render(); await click(labels.clarifyCompose); await click('Prod'); await type('Condition');
    props = { ...props, prompt: { ...props.prompt!, requestId: 'q2' } }; await render();
    expect(container.querySelector('textarea')!.value).toBe('');
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    await act(async () => container.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(props.onCancel).not.toHaveBeenCalled();
  });
  it('does not send on Enter or while composing, sends on Ctrl+Enter', async () => {
    await render(); await type('Line 1\nLine 2');
    for (const options of [{ key: 'Enter' }, { key: 'Enter', ctrlKey: true, isComposing: true }]) {
      await act(async () => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { ...options, bubbles: true })));
    }
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it('blocks empty and overlong answers', async () => {
    await render(); expect(button(labels.clarifySend).disabled).toBe(true);
    await type('a'.repeat(8001)); expect(button(labels.clarifySend).disabled).toBe(true);
    expect(container.querySelector('textarea')!.getAttribute('aria-invalid')).toBe('true');
  });
  it('shows only explicit decisions for approval and expires without approving', async () => {
    vi.useFakeTimers();
    props.prompt = { ...props.prompt!, kind: 'approval', choiceDetails: undefined,
      approval: { operation: 'deploy', target: 'production', impact: 'Updates the live service' }, expiresAt: Date.now() + 2000 };
    await render(); expect(container.querySelector('textarea')).toBeNull();
    expect(button(labels.clarifyAgentDecide)).toBeUndefined(); expect(container.textContent).toContain('production');
    await click(labels.clarifyDeny); expect(props.onSubmit).toHaveBeenCalledWith({ decision: 'deny' });
    await act(async () => vi.advanceTimersByTime(2100));
    expect(button(labels.clarifyApprove).disabled).toBe(true); expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});
