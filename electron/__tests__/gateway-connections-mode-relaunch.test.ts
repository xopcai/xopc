import { expect, it, vi } from 'vitest';

import { GatewayModeRelaunch } from '../gateway/mode-relaunch.js';

it('never schedules a mode switch before cleanup and clears it when the existing quit confirmation is cancelled', () => {
  const quit = vi.fn(), relaunch = vi.fn(), request = new GatewayModeRelaunch({ quit, relaunch });
  request.request(); expect(quit).toHaveBeenCalledOnce(); expect(relaunch).not.toHaveBeenCalled();
  request.cancel(); request.finishCleanup(); expect(relaunch).not.toHaveBeenCalled();
  request.request(); request.finishCleanup(); expect(relaunch).toHaveBeenCalledWith(['--gateway-connections']);
  request.finishCleanup(); expect(relaunch).toHaveBeenCalledOnce();
});

it('retains only the explicit development entry and never forwards local Gateway or other launch arguments', () => {
  const relaunch = vi.fn(), request = new GatewayModeRelaunch({ quit: () => {}, relaunch, entry: '/private/fixture/out/main/index.js' });
  request.request(); request.finishCleanup(); expect(relaunch).toHaveBeenCalledWith(['/private/fixture/out/main/index.js', '--gateway-connections']);
});
