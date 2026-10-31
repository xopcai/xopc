import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ready: vi.fn(), dialog: vi.fn(), relaunch: vi.fn(), quit: vi.fn(),
  parent: { show: vi.fn(), focus: vi.fn(), destroy: vi.fn(), isDestroyed: vi.fn() }, createParent: vi.fn() }));
vi.mock('electron', () => ({ app: { whenReady: mocks.ready, relaunch: mocks.relaunch, quit: mocks.quit }, dialog: { showMessageBox: mocks.dialog },
  BaseWindow: class { constructor(options: unknown) { mocks.createParent(options); return mocks.parent; } } }));
import { recoverGatewayConnectionStartup } from '../gateway/startup-recovery.js';

beforeEach(() => { vi.resetAllMocks(); mocks.ready.mockResolvedValue(undefined); });
it('uses a native recovery dialog and explicitly relaunches the original local entry', async () => {
  mocks.dialog.mockResolvedValue({ response: 0 }); await recoverGatewayConnectionStartup();
  expect(mocks.dialog).toHaveBeenCalledWith(mocks.parent, expect.objectContaining({ buttons: ['使用本地模式', '退出'], cancelId: 1 }));
  expect(mocks.createParent).toHaveBeenCalledWith(expect.objectContaining({ show: false, resizable: false }));
  expect(mocks.parent.show).toHaveBeenCalledOnce(); expect(mocks.parent.focus).toHaveBeenCalledOnce();
  expect(mocks.parent.destroy).toHaveBeenCalledOnce();
  expect(mocks.relaunch).toHaveBeenCalledWith({ args: [] }); expect(mocks.quit).toHaveBeenCalledOnce();
});
it('exits without relaunching if the independent native parent cannot be created', async () => {
  mocks.createParent.mockImplementation(() => { throw new Error('native window unavailable'); });
  await recoverGatewayConnectionStartup();
  expect(mocks.dialog).not.toHaveBeenCalled(); expect(mocks.parent.destroy).not.toHaveBeenCalled();
  expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.quit).toHaveBeenCalledOnce();
});
it('does not switch automatically when the user exits', async () => {
  mocks.dialog.mockResolvedValue({ response: 1 }); await recoverGatewayConnectionStartup();
  expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.quit).toHaveBeenCalledOnce();
  expect(mocks.parent.destroy).toHaveBeenCalledOnce();
});
it('still exits if native recovery fails', async () => {
  mocks.dialog.mockRejectedValue(new Error('native dialog unavailable')); await recoverGatewayConnectionStartup();
  expect(mocks.relaunch).not.toHaveBeenCalled(); expect(mocks.quit).toHaveBeenCalledOnce();
  expect(mocks.parent.destroy).toHaveBeenCalledOnce();
});
