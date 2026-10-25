// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchemaForm } from './schema-form';
import { FormField } from './form-field';
import { Select, SelectOption } from './popover-select';
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
it('associates every schema leaf label with its actual interactive control', async () => {
  await act(async () => root.render(<SchemaForm schema={{ type: 'object', properties: {
    token: { type: 'string', title: 'Bot Token', format: 'password', description: 'Keep private' },
    count: { type: 'number', title: 'Retry count' },
    enabled: { type: 'boolean', title: 'Enable channel' },
    access: { type: 'string', title: 'Private access', enum: ['pairing', 'open'] },
    users: { type: 'array', title: 'Allowed users', items: { type: 'string' } },
  } }} values={{}} onChange={vi.fn()} />));
  const labels = [...container.querySelectorAll<HTMLLabelElement>('label[for]')];
  expect(labels).toHaveLength(5);
  for (const label of labels) {
    const control = document.getElementById(label.htmlFor);
    expect(control?.matches('input, button')).toBe(true);
  }
  const secret = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(document.getElementById(secret.getAttribute('aria-describedby')!)?.textContent).toBe('Keep private');
});
it('names both automation text inputs and custom select triggers', async () => {
  await act(async () => root.render(<><FormField label="Instructions"><textarea /></FormField><FormField label="Agent"><Select><SelectOption value="main">Main</SelectOption></Select></FormField></>));
  for (const label of container.querySelectorAll<HTMLLabelElement>('label[for]')) {
    expect(document.getElementById(label.htmlFor)?.getAttribute('aria-labelledby')).toBe(label.id);
  }
  expect(container.querySelector('button')?.id).toBeTruthy();
});
