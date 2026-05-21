import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCertStatusSummary,
  recordRenewalFailure,
  resetCertStoreStateForTests,
  subscribeCertStatus,
} from '../acme-cert-store.js';

describe('acme-cert-store renewal monitoring', () => {
  afterEach(() => {
    resetCertStoreStateForTests();
  });

  it('records renewal failure in cert status summary', () => {
    recordRenewalFailure(new Error('ACME DNS challenge timed out'));
    const summary = getCertStatusSummary();
    expect(summary.status).toBe('renewal_failed');
    expect(summary.renewalFailed).toBe(true);
    expect(summary.lastRenewalError).toContain('DNS challenge');
    expect(summary.lastRenewalErrorAt).toBeTruthy();
  });

  it('notifies cert status subscribers on failure', () => {
    const listener = vi.fn();
    subscribeCertStatus(listener);
    recordRenewalFailure(new Error('boom'));
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0].status).toBe('renewal_failed');
  });
});
