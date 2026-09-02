import { EndpointToolHostController } from '@xopcai/endpoint-tools-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EndpointToolHost } from '../host';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EndpointToolHost', () => {
  it('keeps the Crypto receiver when creating availability message ids', () => {
    const cryptoMock = {
      randomUUID() {
        if (this !== cryptoMock) throw new TypeError('Illegal invocation');
        return '00000000-0000-4000-8000-000000000001';
      },
    };
    vi.stubGlobal('crypto', cryptoMock);
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true,
    });

    const host = new EndpointToolHost({
      kind: 'desktop',
      platform: 'darwin',
      displayName: 'Desktop',
      appVersion: 'test',
      definitions: [],
      confirmReenrollment: async () => true,
    });
    const controller = (host as unknown as { controller: EndpointToolHostController }).controller;
    const send = vi.fn();
    controller.connect(send);

    expect(() => controller.publishAvailability()).not.toThrow();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      messageId: '00000000-0000-4000-8000-000000000001',
      type: 'endpoint.availability_changed',
      payload: { availability: 'foreground' },
    }));
  });
});
