import { describe, expect, it } from 'vitest';

import {
  formatAcmeDnsChallengeInvalidError,
  resolveAcmeChallengeFqdn,
} from '../acme-client.js';

describe('acme-client helpers', () => {
  it('resolveAcmeChallengeFqdn uses RFC 8555 challenge name', () => {
    expect(resolveAcmeChallengeFqdn('rzjfa9.frp.xopc.ai')).toBe(
      '_acme-challenge.rzjfa9.frp.xopc.ai',
    );
  });

  it('formatAcmeDnsChallengeInvalidError includes CA detail and validation records', () => {
    const message = formatAcmeDnsChallengeInvalidError('_acme-challenge.example.test', {
      error: { detail: 'Incorrect TXT record', type: 'urn:ietf:params:acme:error:dns' },
      validationRecord: ['No TXT record found at _acme-challenge.example.test'],
    });
    expect(message).toContain('_acme-challenge.example.test');
    expect(message).toContain('Incorrect TXT record');
    expect(message).toContain('No TXT record found');
  });
});
