import { expect, it } from 'vitest';

import { DesktopNativeApprovalFocus } from '../desktop/native-approval-focus.js';

it('recognizes only the current trusted visible parent sheet while its application remains active', () => {
  const focus = new DesktopNativeApprovalFocus(), parent = {}, controller = new AbortController();
  expect(focus.focused(parent, 1, true, true)).toBe(false);
  const release = focus.begin(parent, 1, controller.signal);
  expect(focus.focused(parent, 1, true, true)).toBe(true);
  expect(focus.focused({}, 1, true, true)).toBe(false);
  expect(focus.focused(parent, 2, true, true)).toBe(false);
  expect(focus.focused(parent, 1, false, true)).toBe(false);
  expect(focus.focused(parent, 1, true, false)).toBe(false);
  controller.abort(); expect(focus.focused(parent, 1, true, true)).toBe(false);
  const next = new AbortController(), releaseNext = focus.begin(parent, 2, next.signal);
  release(); expect(focus.focused(parent, 2, true, true)).toBe(true);
  releaseNext(); expect(focus.focused(parent, 2, true, true)).toBe(false);
});
