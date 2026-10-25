import type { PhoneEnvironmentAdapter } from '@xopcai/endpoint-tools-protocol';

/** No environment writes until provider format, grants and cleanup are verified. */
export const unsupportedPhoneEnvironmentAdapter: PhoneEnvironmentAdapter = {
  supportedFields: [],
  async apply(_request, signal) {
    signal.throwIfAborted();
    return { status: 'unsupported' };
  },
};
