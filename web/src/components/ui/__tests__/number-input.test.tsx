// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NumberInput } from '../number-input';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let committed: number | undefined;
const changed = vi.fn();
beforeEach(() => {
  changed.mockClear();
  committed = undefined;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Form({ initial = 5, allowEmpty = false, ...props }: Omit<ComponentProps<typeof NumberInput>, 'onChange' | 'value'> & { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  const [revision, setRevision] = useState(0);
  committed = value;
  return <>
    <NumberInput {...props} allowEmpty={allowEmpty} value={value ?? ''} onChange={event => {
      const text = event.target.value;
      changed(text);
      setValue(text === '' ? undefined : Number(text));
    }} />
    <button onClick={() => setRevision(revision + 1)}>Rerender {revision}</button>
    <button onClick={() => setValue(7)}>Reset</button>
  </>;
}
async function edit(text: string) {
  const input = container.querySelector('input')!;
  input.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe(text);
  return input;
}
async function blur() { await act(async () => container.querySelector('input')!.blur()); }

describe('NumberInput editing', () => {
  it('allows deleting the final digit and entering a new number without committing an empty required value', async () => {
    await act(async () => root.render(<Form min={1} max={50} />));
    await edit('');
    expect(committed).toBe(5);
    expect(changed).not.toHaveBeenCalled();
    await edit('2');
    await edit('25');
    await blur();
    expect(committed).toBe(25);
    expect(container.querySelector('input')!.value).toBe('25');
  });

  it('restores the last valid required value only after leaving an empty input', async () => {
    await act(async () => root.render(<Form />));
    await edit('');
    await blur();
    expect(container.querySelector('input')!.value).toBe('5');
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps an optional field cleared and lets the user reenter a value', async () => {
    await act(async () => root.render(<Form allowEmpty min={1} />));
    await edit('');
    expect(committed).toBeUndefined();
    await blur();
    expect(container.querySelector('input')!.value).toBe('');
    await edit('30');
    expect(committed).toBe(30);
  });

  it('keeps intermediate values below the minimum visible while entering a valid multi-digit number', async () => {
    await act(async () => root.render(<Form initial={16} min={16} max={4096} />));
    await edit('');
    await edit('2');
    expect(committed).toBe(16);
    await edit('20');
    expect(committed).toBe(20);
  });

  it.each([['100', '50'], ['0', '1']])('corrects an out-of-range draft %s to %s on blur', async (text, expected) => {
    await act(async () => root.render(<Form min={1} max={50} />));
    await edit(text);
    expect(committed).toBe(5);
    await blur();
    expect(container.querySelector('input')!.value).toBe(expected);
    expect(committed).toBe(Number(expected));
  });

  it('preserves decimal and negative editing text through numeric state updates', async () => {
    await act(async () => root.render(<Form initial={0} min={-10} step="any" />));
    for (const text of ['', '-1', '-1.2', '-1.20', '-1.205']) await edit(text);
    expect(committed).toBe(-1.205);
    await blur();
    expect(container.querySelector('input')!.value).toBe('-1.205');
  });

  it('does not replace empty editing text during unrelated parent renders', async () => {
    await act(async () => root.render(<Form />));
    const input = await edit('');
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('input')).toBe(input);
    expect(input.value).toBe('');
    await blur();
    await act(async () => container.querySelectorAll('button')[1].click());
    expect(input.value).toBe('7');
  });
});
