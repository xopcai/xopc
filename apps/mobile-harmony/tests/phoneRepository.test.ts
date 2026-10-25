import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), destroy: vi.fn() }));
vi.mock('@kit.NetworkKit', () => ({ http: {
  createHttp: () => ({ destroy: mocks.destroy }), RequestMethod: { GET: 'GET' }, HttpDataType: { ARRAY_BUFFER: 'ARRAY_BUFFER' },
} }));
vi.mock('../entry/src/main/ets/service/deviceCrypto.ets', () => ({ XopcDeviceCrypto: class { uuid() { return 'client'; } } }));
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: {
  connectionRevision: () => 1, assertConnection: vi.fn(), transferAuth: async () => ({ origin: 'https://example.test', token: 'test' }),
} }));
vi.mock('../entry/src/main/ets/service/requestProof.ets', () => ({ signedHttpRequest: mocks.request }));
vi.mock('../entry/src/main/ets/service/transport.ets', () => ({ XopcHttpError: class extends Error {} }));

import { XopcPhoneRepository } from '../entry/src/main/ets/repository/phoneRepository.ets';

beforeEach(() => { vi.clearAllMocks(); });
it.each(['lowercase', 'canonical'])('retains snapshot sequence with %s HTTP headers for manual input', async casing => {
  const header = casing === 'lowercase'
    ? { 'x-phone-frame-seq': '42', 'x-phone-width': '100', 'x-phone-height': '200', 'x-phone-captured-at': '1792940000000' }
    : { 'X-Phone-Frame-Seq': '42', 'X-Phone-Width': '100', 'X-Phone-Height': '200', 'X-Phone-Captured-At': '1792940000000' };
  const bytes = new ArrayBuffer(1);
  mocks.request.mockResolvedValue({ responseCode: 200, result: bytes, header });
  const result = await new XopcPhoneRepository().frame({ conversationId: 'conversation', transcriptId: 'transcript', phoneSessionId: 'phone', phoneDeviceId: 'device' });
  expect(result).toEqual({ bytes, seq: 42, width: 100, height: 200, capturedAt: 1792940000000 });
  expect(mocks.destroy).toHaveBeenCalledOnce();
});
