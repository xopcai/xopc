import { describe, expect, it, vi } from 'vitest';

import {
  allAcmeDnsResolversHaveTxt,
  formatAcmeDnsChallengeInvalidError,
  isRetryableAcmeDnsError,
  probeAcmeDnsTxtAllResolvers,
  resolveAcmeChallengeFqdn,
  waitForDnsTxtConsensus,
  type AcmeDnsTxtProbe,
} from '../acme-client.js';

describe('acme-client helpers', () => {
  it('resolveAcmeChallengeFqdn uses RFC 8555 challenge name', () => {
    expect(resolveAcmeChallengeFqdn('rzjfa9.frp.xopc.ai')).toBe(
      '_acme-challenge.rzjfa9.frp.xopc.ai',
    );
  });

  it('formatAcmeDnsChallengeInvalidError includes CA detail and string validation records', () => {
    const message = formatAcmeDnsChallengeInvalidError('_acme-challenge.example.test', {
      error: { detail: 'Incorrect TXT record', type: 'urn:ietf:params:acme:error:dns' },
      validationRecord: ['No TXT record found at _acme-challenge.example.test'],
    });
    expect(message).toContain('_acme-challenge.example.test');
    expect(message).toContain('Incorrect TXT record');
    expect(message).toContain('No TXT record found');
    expect(message).not.toContain('[object Object]');
  });

  it('formatAcmeDnsChallengeInvalidError stringifies object validation records', () => {
    const message = formatAcmeDnsChallengeInvalidError('_acme-challenge.example.test', {
      error: {
        detail: 'During secondary validation: No TXT record found',
        type: 'urn:ietf:params:acme:error:dns',
      },
      validationRecord: [
        {
          hostname: '_acme-challenge.example.test',
          error: 'No TXT record found',
        },
      ],
    });
    expect(message).toContain('During secondary validation');
    expect(message).toContain('_acme-challenge.example.test: No TXT record found');
    expect(message).not.toContain('[object Object]');
  });

  it('isRetryableAcmeDnsError detects secondary validation and propagation failures', () => {
    expect(
      isRetryableAcmeDnsError(
        new Error(
          'ACME DNS-01 challenge invalid for _acme-challenge.example.test — During secondary validation: No TXT record found',
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableAcmeDnsError(
        new Error('DNS TXT not visible on all resolvers for _acme-challenge.example.test'),
      ),
    ).toBe(true);
    expect(isRetryableAcmeDnsError(new Error('ACME order invalid'))).toBe(false);
  });

  it('allAcmeDnsResolversHaveTxt requires every resolver to see the expected TXT', () => {
    const expected = 'abc123';
    const probes: AcmeDnsTxtProbe[] = [
      { resolver: '8.8.8.8', values: [expected] },
      { resolver: '1.1.1.1', values: [expected] },
      { resolver: '9.9.9.9', values: ['other'] },
    ];
    expect(allAcmeDnsResolversHaveTxt(probes, expected)).toBe(false);

    probes[2] = { resolver: '9.9.9.9', values: [expected] };
    expect(allAcmeDnsResolversHaveTxt(probes, expected)).toBe(true);
  });

  it('probeAcmeDnsTxtAllResolvers queries each resolver independently', async () => {
    const probes = await probeAcmeDnsTxtAllResolvers('example.com');
    expect(probes).toHaveLength(3);
    expect(probes.map((probe) => probe.resolver)).toEqual(['8.8.8.8', '1.1.1.1', '9.9.9.9']);
    for (const probe of probes) {
      expect(Array.isArray(probe.values)).toBe(true);
    }
  });

  it('waitForDnsTxtConsensus polls immediately without a blind initial delay', async () => {
    const expected = 'txt-value';
    const sleep = vi.fn(async (_ms: number) => {});
    const probe = vi.fn(async (): Promise<AcmeDnsTxtProbe[]> => [
      { resolver: '8.8.8.8', values: [expected] },
      { resolver: '1.1.1.1', values: [expected] },
      { resolver: '9.9.9.9', values: [expected] },
    ]);

    await waitForDnsTxtConsensus('_acme-challenge.example.test', expected, {
      minPropagationMs: 0,
      stableMs: 0,
      consensusRounds: 2,
      pollIntervalMs: 1,
      timeoutMs: 5_000,
      probe,
      sleep,
    });

    expect(probe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
