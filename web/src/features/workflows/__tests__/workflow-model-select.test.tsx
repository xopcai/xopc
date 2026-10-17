// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { WorkflowModelSelect } from '../workflow-model-select';

vi.mock('swr', () => ({ default: () => ({ data: { defaults: { models: { chat: { primary: 'provider/global-model' } } } } }) }));
vi.mock('@/features/chat/model/model-selector', () => ({ ModelSelector: ({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) => <>
  <button role="combobox">{value || placeholder}</button>
  <button onClick={() => onChange('provider/special-model')}>Pick model</button>
  <button onClick={() => onChange('')}>Use default</button>
</> }));

it('displays the actual global default and supports an explicit model and reverting to default', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); const change = vi.fn();
  try {
    await act(async () => root.render(<WorkflowModelSelect language="zh" onChange={change} />));
    expect(element.querySelector('[role="combobox"]')?.textContent).toBe('全局默认模型 · provider/global-model');
    expect(element.querySelector('input')).toBeNull();
    await act(async () => (element.querySelectorAll('button')[1]).click());
    expect(change).toHaveBeenLastCalledWith('provider/special-model');
    await act(async () => root.render(<WorkflowModelSelect language="en" value="provider/special-model" onChange={change} />));
    expect(element.querySelector('[role="combobox"]')?.textContent).toBe('provider/special-model');
    await act(async () => (element.querySelectorAll('button')[2]).click());
    expect(change).toHaveBeenLastCalledWith(undefined);
  } finally { await act(async () => root.unmount()); element.remove(); }
});
