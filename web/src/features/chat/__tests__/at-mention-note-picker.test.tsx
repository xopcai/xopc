// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AtMentionPicker } from '@/features/chat/palette/at-mention-picker';

describe('@ mention Note picker', () => {
  let container: HTMLDivElement;
  let anchor: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    anchor = document.createElement('div');
    anchor.getBoundingClientRect = () => ({
      x: 10, y: 100, left: 10, top: 100, right: 410, bottom: 140,
      width: 400, height: 40, toJSON: () => ({}),
    });
    document.body.append(anchor, container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    anchor.remove();
    container.remove();
  });

  it('renders a Note section and returns the selected Note item', () => {
    const onSelectItem = vi.fn();
    act(() => {
      root.render(
        <AtMentionPicker
          open
          anchorRef={{ current: anchor }}
          items={[{
            kind: 'note',
            name: 'Launch plan',
            description: 'Plan snapshot',
            noteRef: { sourceId: 'note-1', expectedVersion: '42' },
          }]}
          selectedIndex={0}
          loading={false}
          query="launch"
          noResults="No matches"
          sessionKey="session-1"
          recentLabel="Recent"
          filesLabel="Files"
          notesLabel="Notes"
          ariaLabel="Search references"
          onSelectItem={onSelectItem}
        />,
      );
    });

    expect(document.body.textContent).toContain('Notes');
    expect(document.body.textContent).toContain('Launch plan');
    expect(document.body.textContent).toContain('Plan snapshot');

    act(() => {
      document.body.querySelector<HTMLElement>('[role="option"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'note', noteRef: { sourceId: 'note-1', expectedVersion: '42' } }),
      { shiftKey: false },
    );
  });
});
