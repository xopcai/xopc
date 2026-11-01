import { EventEmitter } from 'node:events';

import { expect, it, vi } from 'vitest';

import { installDesktopSessionBoundary } from '../desktop/session-boundary.js';

it('revokes active desktop authority on lock/suspend, never restores on unlock, and releases listeners', () => {
  const source = new EventEmitter(), stop = vi.fn();
  const release = installDesktopSessionBoundary(source, stop);
  source.emit('lock-screen'); source.emit('unlock-screen'); expect(stop).toHaveBeenCalledTimes(1);
  source.emit('suspend'); expect(stop).toHaveBeenCalledTimes(2);
  release(); source.emit('lock-screen'); expect(stop).toHaveBeenCalledTimes(2);
  expect(source.listenerCount('suspend')).toBe(0);
});
