// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { APP_PORTALED_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

import { PopoverSelect } from './popover-select';

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

describe('PopoverSelect', () => {
  it('opens above a high app dialog when its content is portaled to the body', async () => {
    const container = document.createElement('div');
    container.className = 'z-[125]';
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <PopoverSelect
          value=""
          options={[{ value: 'project-1', label: 'Project one' }]}
          placeholder="No project"
          onChange={() => {}}
        />,
      );
    });
    mounted.push({ container, unmount: () => root.unmount() });

    const trigger = container.querySelector('button');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    const option = Array.from(document.body.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Project one'));
    expect(option).toBeDefined();
    expect(option?.parentElement?.parentElement?.className).toContain(APP_PORTALED_POPOVER_Z);
  });
});
