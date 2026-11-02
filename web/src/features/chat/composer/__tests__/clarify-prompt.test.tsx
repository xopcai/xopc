import batchFixture from '../../../../../../packages/gateway-contract/fixtures/clarification-v2.json';
import { clarifyToolInputV2Schema } from '@xopcai/gateway-contract';
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
  it('keeps choices immediate even when compose mode is requested', async () => {
    props.prompt!.interactionMode = 'compose';
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    await click('Prod');
    expect(props.onSubmit).toHaveBeenCalledWith({ response: { choiceId: 'prod' } });
  });
  it('reveals custom input on demand and preserves it after a failed submission', async () => {
    await render();
    expect(container.querySelector('textarea')).toBeNull();
    await click(labels.clarifyCustomLabel); await type('After 22:00\nVerify first');
    props = { ...props, submitError: 'Network failed' }; await render();
    expect(container.querySelector('textarea')!.value).toBe('After 22:00\nVerify first');
    await click(labels.clarifySend);
    expect(props.onSubmit).toHaveBeenCalledWith({ response: { text: 'After 22:00\nVerify first' } });
  });
  it('resets the custom editor for another question', async () => {
    await render(); await click(labels.clarifyCustomLabel); await type('Condition');
    props = { ...props, prompt: { ...props.prompt!, requestId: 'q2' } }; await render();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  });
  it('does not send on Enter or while composing, sends on Ctrl+Enter', async () => {
    await render(); await click(labels.clarifyCustomLabel); await type('Line 1\nLine 2');
    for (const options of [{ key: 'Enter' }, { key: 'Enter', ctrlKey: true, isComposing: true }]) {
      await act(async () => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { ...options, bubbles: true })));
    }
    expect(props.onSubmit).not.toHaveBeenCalled();
    await act(async () => container.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });
  it('blocks empty and overlong answers', async () => {
    await render(); await click(labels.clarifyCustomLabel); expect(button(labels.clarifySend).disabled).toBe(true);
    await type('a'.repeat(8001)); expect(button(labels.clarifySend).disabled).toBe(true);
    expect(container.querySelector('textarea')!.getAttribute('aria-invalid')).toBe('true');
  });
  it('advances choices automatically, restores earlier answers and submits the full batch', async () => {
    props.prompt = { ...props.prompt!, ...clarifyToolInputV2Schema.parse(batchFixture), choiceDetails: undefined, recommendedChoiceId: undefined };
    await render();
    expect(container.textContent).toContain('0/3 answered');
    expect(container.querySelector('textarea')).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
    await click('Blog');
    expect(container.textContent).toContain('1/3 answered');
    await click('Weekly'); await type('Engineering notes');
    expect(props.onSubmit).not.toHaveBeenCalled();
    await click('Previous');
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Weekly');
    await click('Previous');
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain('Blog');
    await click('Blog');
    expect(props.onSubmit).toHaveBeenCalledWith({ schemaVersion: 2, answers: [
      { questionId: 'channel', choiceId: 'blog' },
      { questionId: 'frequency', choiceId: 'weekly' }, { questionId: 'direction', text: 'Engineering notes' },
    ] });
  });
  it('submits a single v2 choice immediately and blocks duplicate clicks while saving', async () => {
    const fixture = clarifyToolInputV2Schema.parse(batchFixture);
    props.prompt = { ...props.prompt!, ...fixture, questions: [fixture.questions[0]] };
    let finish!: () => void;
    props.onSubmit = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await act(async () => { button('Blog').click(); button('Blog').click(); });
    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith({ schemaVersion: 2, answers: [{ questionId: 'channel', choiceId: 'blog' }] });
    await act(async () => finish());
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
