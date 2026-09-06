// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { models } = vi.hoisted(() => ({ models: [
  { id: 'test/one', name: 'Model One', provider: 'test', reasoning: true,
    thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low', supportsAdaptive: false } },
  { id: 'other/two', name: 'Model Two', provider: 'other', reasoning: false,
    thinking: { mode: 'none', options: ['off'], initialValue: 'off', supportsAdaptive: false } },
  { id: 'xopc-cloud/openai-codex/gpt-5.6-luna', name: 'openai-codex/gpt-5.6-luna', provider: 'xopc-cloud', reasoning: true,
    thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low', supportsAdaptive: false } },
] }));
vi.mock('swr', () => ({ default: () => ({ data: models, isLoading: false, mutate: vi.fn() }) }));

import { ComposerModelConfigControl } from '../model/composer-model-config-control';
import { messages } from '@/i18n/messages';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === name)!;
const click = async (element: HTMLElement) => act(async () => element.click());

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(props = {}) {
  await act(async () => root.render(<MemoryRouter><ComposerModelConfigControl
    chat={messages('en').chat} sessionModel="test/one" thinkingLevel="high" modelSupportsThinking
    modelDisabled={false} thinkingDisabled={false} onModelChange={vi.fn()} onThinkingChange={vi.fn()} {...props}
  /></MemoryRouter>));
  await click(container.querySelector('button')!);
}

describe('composer model configuration', () => {
  it('shows only the model name for a provider-routed model and retains its identity in the picker', async () => {
    await render({ sessionModel: 'xopc-cloud/openai-codex/gpt-5.6-luna', thinkingLevel: 'low' });
    const trigger = container.querySelector('button')!;
    expect(trigger.textContent).toBe('gpt-5.6-luna· Low');
    expect(trigger.title).toBe('gpt-5.6-luna');
    expect(trigger.getAttribute('aria-label')).not.toContain('openai-codex');
    await click(button('openai-codex/gpt-5.6-lunaxopc-cloud'));
    expect(button('openai-codex/gpt-5.6-lunaxopc-cloud').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows concrete identity and only supported thinking levels in one popover', async () => {
    await render();
    expect(container.textContent).toContain('Model One');
    expect(button('High').getAttribute('aria-pressed')).toBe('true');
    expect(button('Low')).toBeTruthy();
    expect(button('Medium')).toBeUndefined();
    expect(document.body.textContent).not.toContain('Default');
    await click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Model Onetest')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Model Two');
  });

  it('keeps the previous selection and surfaces a failed save', async () => {
    const change = vi.fn(async () => { throw new Error('Configuration changed elsewhere'); });
    await render({ onThinkingChange: change });
    await click(button('Low'));
    expect(change).toHaveBeenCalledWith('low');
    expect(button('High').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Configuration changed elsewhere');
  });

  it('keeps an unavailable model visible and permits choosing a replacement', async () => {
    await render({ sessionModel: 'removed/original' });
    expect(container.textContent).toContain('original');
    expect(container.textContent).toContain('Unavailable');
    expect(document.querySelector('[role="group"]')).toBeNull();
  });
});
