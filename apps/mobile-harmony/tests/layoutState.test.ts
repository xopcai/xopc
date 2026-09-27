import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
});
import { XopcLayoutState } from '../entry/src/main/ets/service/layoutState.ets';

describe('main dock visibility', () => {
  it('preserves keyboard and attachment-panel exclusion', () => {
    const layout = new XopcLayoutState();
    layout.chatActionsOpen = true;
    expect(layout.isMainDockVisible(0)).toBe(false);
    layout.chatActionsOpen = false;
    layout.keyboardVisible = true;
    for (const tab of [0, 1, 2, 3, 4]) expect(layout.isMainDockVisible(tab)).toBe(false);
  });

  it('does not let hidden chat overlays suppress another tab', () => {
    const layout = new XopcLayoutState();
    layout.chatActionsOpen = true;
    for (const tab of [1, 2, 3, 4]) expect(layout.isMainDockVisible(tab)).toBe(true);
  });
});
