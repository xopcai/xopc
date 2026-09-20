// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DatePicker } from '@/components/ui/date-picker';
import { parseDatePickerValue, toDatePickerValue } from '@/components/ui/date-picker.utils';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
});

describe('date picker value helpers', () => {
  it('round-trips a local calendar date without timezone drift', () => {
    const date = parseDatePickerValue('2026-08-25');

    expect(date).not.toBeNull();
    expect(toDatePickerValue(date!)).toBe('2026-08-25');
  });

  it('supports leap days and rejects impossible dates', () => {
    expect(toDatePickerValue(parseDatePickerValue('2028-02-29')!)).toBe('2028-02-29');
    expect(parseDatePickerValue('2027-02-29')).toBeNull();
    expect(parseDatePickerValue('2026-13-01')).toBeNull();
    expect(parseDatePickerValue('')).toBeNull();
  });

  it('uses the project calendar inside a modal and enforces its minimum date', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <div role="dialog">
          <DatePicker
            value="2026-10-20"
            min="2026-10-15"
            ariaLabel="Focus through"
            onChange={() => {}}
          />
        </div>,
      );
    });
    mounted.push({ container, unmount: () => root.unmount() });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Focus through"]')?.click();
      await Promise.resolve();
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.querySelector('[role="grid"]')).not.toBeNull();
    expect(dialog?.querySelector('input[type="date"]')).toBeNull();

    const beforeMinimumLabel = new Intl.DateTimeFormat('en', { dateStyle: 'full' })
      .format(new Date(2026, 9, 14, 12));
    expect(dialog?.querySelector<HTMLButtonElement>(`button[aria-label="${beforeMinimumLabel}"]`)?.disabled)
      .toBe(true);
  });
});
