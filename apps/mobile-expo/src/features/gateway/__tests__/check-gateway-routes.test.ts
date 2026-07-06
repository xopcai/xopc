import { describe, expect, it } from 'vitest';

import { formatReachabilityReason } from '../check-gateway-routes';

const labels = {
  timeout: 'timeout-msg',
  networkError: 'network-msg',
  networkErrorWithDetail: 'network-detail: {{detail}}',
  invalidUrl: 'invalid-url-msg',
  httpError: 'http {{status}}',
};

describe('formatReachabilityReason', () => {
  it('formats network error detail', () => {
    expect(
      formatReachabilityReason(
        { status: 'unreachable', reason: 'network_error', detail: 'Network request failed' },
        labels,
      ),
    ).toBe('network-detail: Network request failed');
  });

  it('falls back to plain network message without a detail', () => {
    expect(
      formatReachabilityReason({ status: 'unreachable', reason: 'network_error' }, labels),
    ).toBe('network-msg');
  });

  it('formats timeout, invalid url, and http status reasons', () => {
    expect(
      formatReachabilityReason({ status: 'unreachable', reason: 'timeout' }, labels),
    ).toBe('timeout-msg');
    expect(
      formatReachabilityReason({ status: 'unreachable', reason: 'invalid_url' }, labels),
    ).toBe('invalid-url-msg');
    expect(
      formatReachabilityReason(
        { status: 'unreachable', reason: 'http_error', httpStatus: 502 },
        labels,
      ),
    ).toBe('http 502');
  });

  it('returns empty string for reachable routes', () => {
    expect(formatReachabilityReason({ status: 'reachable' }, labels)).toBe('');
  });
});
