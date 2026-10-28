import { useGatewayStore } from '@/stores/gateway-store';

import type { DiscussionCaptureSettings } from './discussion-types';

const key = () => `xopc-recording-consent:${useGatewayStore.getState().baseUrl}`;

export function rememberDiscussionConsent(settings: DiscussionCaptureSettings): void {
  if (settings.consentAcknowledgedAt == null) {
    forgetDiscussionConsent();
    return;
  }
  try { localStorage.setItem(key(), JSON.stringify(settings)); } catch { /* Recording still works without a cache. */ }
}

export function readDiscussionConsent(): DiscussionCaptureSettings | null {
  try {
    const cached = JSON.parse(localStorage.getItem(key()) ?? 'null') as DiscussionCaptureSettings | null;
    return cached && Number.isSafeInteger(cached.consentPolicyVersion) && cached.consentPolicyVersion > 0
      && typeof cached.consentAcknowledgedAt === 'number' && Number.isFinite(cached.consentAcknowledgedAt) && cached.consentAcknowledgedAt > 0 ? cached : null;
  } catch { return null; }
}

export function forgetDiscussionConsent(): void {
  try { localStorage.removeItem(key()); } catch { /* Storage may be unavailable. */ }
}
