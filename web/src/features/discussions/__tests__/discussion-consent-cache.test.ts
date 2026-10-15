// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readDiscussionConsent, rememberDiscussionConsent } from '../discussion-consent-cache';

beforeEach(() => localStorage.clear());
describe('offline recording consent', () => {
  it('persists only acknowledged consent for subsequent offline starts', () => {
    rememberDiscussionConsent({ consentPolicyVersion: 1 });
    expect(readDiscussionConsent()).toBeNull();
    rememberDiscussionConsent({ consentPolicyVersion: 2, consentAcknowledgedAt: 10 });
    expect(readDiscussionConsent()).toEqual({ consentPolicyVersion: 2, consentAcknowledgedAt: 10 });
  });
  it('does not bypass first-use confirmation with corrupt local data', () => {
    localStorage.setItem(`xopc-recording-consent:${window.location.origin}`, '{broken');
    expect(readDiscussionConsent()).toBeNull();
  });
});
