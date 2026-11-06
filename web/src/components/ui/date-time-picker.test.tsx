// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

import { DateTimePicker } from './date-time-picker';

it('uses the app pickers to update and clear the local date and time inside a dialog', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  const language = useLocaleStore.getState().language;
  useLocaleStore.setState({ language: 'en' });
  function Fixture() {
    const [value, setValue] = useState('2026-11-06T14:30');
    return <div role="dialog"><DateTimePicker label="Run at" value={value} defaultTime="09:00"
      onChange={next => { setValue(next); changed(next); }} /></div>;
  }
  const date = () => container.querySelector<HTMLButtonElement>('button[aria-label="Run at · Date"]')!;
  const time = () => container.querySelector<HTMLButtonElement>('button[aria-label="Run at · Time"]')!;
  const settlePopover = () => act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  const selectDay = async (day: number) => {
    const label = new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date(2026, 10, day, 12));
    await act(async () => container.querySelector<HTMLButtonElement>(`[role=gridcell][aria-label="${label}"]`)!.click());
  };
  try {
    await act(async () => root.render(<Fixture />));
    expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    await act(async () => date().click());
    await selectDay(7);
    expect(changed).toHaveBeenLastCalledWith('2026-11-07T14:30');
    await settlePopover();
    await act(async () => time().click());
    const minutes = container.querySelector('[role=listbox][aria-label="Run at · Time MM"]')!;
    await act(async () => ([...minutes.querySelectorAll('button')].find(button => button.textContent === '45'))!.click());
    expect(changed).toHaveBeenLastCalledWith('2026-11-07T14:45');
    await settlePopover();
    await act(async () => date().click());
    await act(async () => ([...container.querySelectorAll('button')].find(button => button.textContent === 'Clear'))!.click());
    expect(changed).toHaveBeenLastCalledWith('');
    expect(time().disabled).toBe(true);
    await settlePopover();
    await act(async () => date().click());
    await selectDay(8);
    expect(changed).toHaveBeenLastCalledWith('2026-11-08T09:00');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    useLocaleStore.setState({ language });
    vi.unstubAllGlobals();
  }
});
