import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ready: vi.fn(), dialog: vi.fn(), relaunch: vi.fn(), quit: vi.fn() }));
vi.mock('electron', () => ({ app: { whenReady: mocks.ready, relaunch: mocks.relaunch, quit: mocks.quit }, dialog: { showMessageBox: mocks.dialog } }));
import { recoverGatewayConnectionStartup } from '../gateway/startup-recovery.js';

beforeEach(() => { vi.resetAllMocks(); mocks.ready.mockResolvedValue(undefined); });
it('uses a native recovery dialog and explicitly relaunches the original local entry', async () => {
  mocks.dialog.mockResolvedValue({ response: 0 }); await recoverGatewayConnectionStartup();
  expect(mocks.dialog).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['使用本地模式', '退出'], cancelId: 1 }));
  expect(mocks.relaunch).toHaveBeenCalledWith({ args: [] }); expect(mocks.quit).toHaveBeenCalledOnce();
});
it('does not switch automatically when the user exits', async () => {
  mocks.dialog.mockResolvedValue({ response: 1 }); await recoverGatewayConnectionStartup();
  expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.quit).toHaveBeenCalledOnce();
});
it('still exits if native recovery fails', async () => {
  mocks.dialog.mockRejectedValue(new Error('native dialog unavailable')); await recoverGatewayConnectionStartup();
  expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.quit).toHaveBeenCalledOnce();
});
