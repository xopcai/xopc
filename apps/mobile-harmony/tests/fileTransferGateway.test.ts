import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ select: vi.fn(), open: vi.fn(), auth: vi.fn(), assert: vi.fn(), http: vi.fn() }));
vi.mock('@kit.AbilityKit', () => ({}));
vi.mock('@kit.NetworkKit', () => ({ http: { createHttp: mocks.http } }));
vi.mock('@kit.CoreFileKit', () => ({ fileIo: { open: mocks.open }, picker: {
  DocumentSelectOptions: class {}, DocumentViewPicker: class { select = mocks.select; },
}, fileUri: {} }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  connectionRevision: () => 7, assertConnection: mocks.assert, transferAuth: mocks.auth,
} }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));
import { XopcFileTransfer } from '../entry/src/main/ets/service/fileTransfer.ets';
it('does not upload a file selected for a previous Gateway after switching', async () => {
  mocks.select.mockResolvedValue(['file://old-selection']);
  mocks.assert.mockImplementation(() => { throw new Error('OPERATION_CANCELLED'); });
  await expect(new XopcFileTransfer().upload({} as never, 'old-space', '/')).rejects.toThrow('OPERATION_CANCELLED');
  expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
});
