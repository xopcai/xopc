// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAtMentionPicker } from '@/features/chat/palette/use-at-mention-picker';

describe('useAtMentionPicker session preparation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('materializes a project session when @ opens before a conversation exists', async () => {
    const prepareSession = vi.fn(() => new Promise<string | null>(() => {}));
    function Harness() {
      const picker = useAtMentionPicker('@', 1, {
        conversationId: null,
        slashPaletteOpen: false,
        prepareSession,
      });
      return <output data-loading={picker.loading}>{String(picker.open)}</output>;
    }

    await act(async () => root.render(<Harness />));

    expect(prepareSession).toHaveBeenCalledOnce();
    expect(container.querySelector('output')?.dataset.loading).toBe('true');
  });
});
