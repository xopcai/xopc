import { expect, it, vi } from 'vitest';

import { RemoteWindowPresentation } from '../gateway/window-presentation.js';

const window = (destroyed = false) => ({ isDestroyed: () => destroyed, show: vi.fn(), focus: vi.fn() });

it('keeps normal remote windows visible and restores their recovery entry', () => {
  const policy = new RemoteWindowPresentation(), target = window();
  expect(policy.showInitially).toBe(true); policy.reveal(target);
  expect(target.show).toHaveBeenCalledOnce(); expect(target.focus).toHaveBeenCalledOnce();
});
it('keeps automatic background recovery from taking desktop focus', () => {
  const policy = new RemoteWindowPresentation(true), target = window();
  expect(policy.showInitially).toBe(false); policy.reveal(target);
  expect(target.show).not.toHaveBeenCalled(); expect(target.focus).not.toHaveBeenCalled();
});
it('allows an explicit local user request to reveal the hidden connection window', () => {
  const policy = new RemoteWindowPresentation(true), target = window(); policy.reveal(target, true);
  expect(policy.showInitially).toBe(true);
  expect(target.show).toHaveBeenCalledOnce(); expect(target.focus).toHaveBeenCalledOnce();
});
it('does not reveal destroyed windows, including explicit requests', () => {
  const policy = new RemoteWindowPresentation(true), target = window(true); policy.reveal(target, true);
  expect(target.show).not.toHaveBeenCalled(); expect(target.focus).not.toHaveBeenCalled();
});
