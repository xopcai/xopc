import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: new Map<string, string>(), gatewayId: 'gateway-a', deviceId: 'device-a' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '99a232c3-48e8-48d0-b34d-296d7841e752' }));
vi.mock('../../../storage/mmkv', () => ({ storage: {
  getString: (key: string) => state.values.get(key), set: (key: string, value: string) => state.values.set(key, value),
  delete: (key: string) => state.values.delete(key),
} }));
vi.mock('../../../stores/gateway-store', () => ({ useGatewayStore: { getState: () => ({
  getActiveProfile: () => ({ gatewayId: state.gatewayId, deviceId: state.deviceId }),
}) } }));
import { createLocalSessionDraft, readLocalSessionDraft, saveLocalSessionDraft, patchLocalSessionDraft } from '../local-session-drafts';
import { localMessageScope } from '../local-messages-store';
import { readMessageOutbox, upsertMessageOutbox } from '../message-outbox';

beforeEach(() => { state.values.clear(); state.gatewayId = 'gateway-a'; state.deviceId = 'device-a'; });
const creation = { agentId: 'writer', projectId: null, execution: null, temporary: false, model: 'test/model', thinkingLevel: 'off' };

it('persists a final conversation identity and isolates Gateway and paired-device principals', () => {
  const id = createLocalSessionDraft(creation);
  expect(readLocalSessionDraft(id)?.creation).toEqual(creation);
  state.gatewayId = 'gateway-b'; expect(readLocalSessionDraft(id)).toBeUndefined();
  state.gatewayId = 'gateway-a'; state.deviceId = 'device-b'; expect(readLocalSessionDraft(id)).toBeUndefined();
  state.deviceId = 'device-a'; expect(readLocalSessionDraft(id)?.conversationId).toBe(id);
  expect(localMessageScope('gateway-a', id, 'device-a')).not.toBe(localMessageScope('gateway-a', id, 'device-b'));
});

it('prevents creation changes while an input or materialization is awaiting acknowledgement', () => {
  const id = createLocalSessionDraft(creation);
  patchLocalSessionDraft(id, { model: 'test/other' });
  const draft = readLocalSessionDraft(id)!;
  draft.clientMessageId = 'input-1'; saveLocalSessionDraft(draft);
  expect(() => patchLocalSessionDraft(id, { model: 'test/new' })).toThrow('awaiting confirmation');
  delete draft.clientMessageId; draft.materialization = { commandId: 'voice-1', purpose: 'voice' }; saveLocalSessionDraft(draft);
  expect(() => patchLocalSessionDraft(id, { thinkingLevel: 'high' })).toThrow('awaiting confirmation');
});

it('keeps a temporary draft and its pending input in memory only', () => {
  const id = createLocalSessionDraft({ ...creation, temporary: true });
  const scope = localMessageScope('gateway-a', id, 'device-a');
  upsertMessageOutbox(scope, { gatewayId: 'gateway-a', conversationId: id, clientMessageId: 'private',
    content: 'private text', delivery: 'next', attachments: [], contextRefs: [] }, 'sending');
  expect(readLocalSessionDraft(id)?.creation.temporary).toBe(true);
  expect(readMessageOutbox(scope)[0]?.submission.content).toBe('private text');
  expect(state.values.size).toBe(0);
});
