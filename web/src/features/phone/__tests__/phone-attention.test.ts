// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { phoneAttentionKey, usePhoneAttention } from '../phone-attention';
import { useGatewayStore } from '@/stores/gateway-store';
import type { PhoneLiveState } from '../phone-live-api';

const report: PhoneLiveState['report'] = { sessionId: 'session', deviceName: 'Phone', agentId: 'main', modelRef: 'phone/model',
  status: 'needs_user', mode: 'control', actions: 0, modelRequests: 0, updatedAt: 1,
  transcriptId: 'transcript', assistanceId: 'request', assistanceVersion: 1, controlEpoch: 1 };
beforeEach(() => { usePhoneAttention.setState({ seen: [] }); useGatewayStore.setState({ baseUrl: 'http://gateway', conversationId: 'account' }); });
it('does not relight an acknowledged request when control changes or the page refreshes', async () => {
  const key = phoneAttentionKey('chat', report)!;
  usePhoneAttention.getState().markSeen(key);
  expect(phoneAttentionKey('chat', { ...report, status: 'paused', controlEpoch: 5 })).toBe(key);
  await usePhoneAttention.persist.rehydrate();
  expect(usePhoneAttention.getState().seen).toContain(key);
  expect(phoneAttentionKey('chat', { ...report, assistanceId: 'another' })).not.toBe(key);
  expect(phoneAttentionKey('chat', { ...report, assistanceVersion: 2 })).not.toBe(key);
});
it('scopes viewed requests to gateway, account, conversation and transcript', () => {
  const key = phoneAttentionKey('chat', report)!;
  expect(phoneAttentionKey('other-chat', report)).not.toBe(key);
  expect(phoneAttentionKey('chat', { ...report, transcriptId: 'new' })).not.toBe(key);
  useGatewayStore.setState({ conversationId: 'other-account' });
  expect(phoneAttentionKey('chat', report)).not.toBe(key);
  expect(phoneAttentionKey('chat', { ...report, status: 'closed' })).toBeNull();
});
