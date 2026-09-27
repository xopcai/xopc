import { randomUUID } from 'expo-crypto';
import type { SessionCreation } from '@xopcai/gateway-contract';
import { storage } from '../../storage/mmkv';
import { useGatewayStore } from '../../stores/gateway-store';
import { markVolatileMessageOutbox } from './message-outbox';
import { localMessageScope } from './local-messages-store';

const temporaryDrafts = new Map<string, LocalSessionDraft>();

export type LocalSessionDraft = { conversationId: string; creation: SessionCreation; createdAt: string; clientMessageId?: string;
  materialization?: { commandId: string; purpose: 'voice' | 'session_resources' } };

function key(id: string): string {
  const profile = useGatewayStore.getState().getActiveProfile();
  if (!profile) throw new Error('Pair a work computer before opening a conversation');
  return `chat.localDraft:${profile.gatewayId}:${profile.deviceId}:${id}`;
}

export function readLocalSessionDraft(id: string): LocalSessionDraft | undefined {
  const temporary = temporaryDrafts.get(key(id));
  if (temporary) return structuredClone(temporary);
  const raw = storage.getString(key(id));
  return raw ? JSON.parse(raw) as LocalSessionDraft : undefined;
}

export function saveLocalSessionDraft(draft: LocalSessionDraft): void {
  if (draft.creation.temporary) {
    const profile = useGatewayStore.getState().getActiveProfile();
    if (!profile) throw new Error('Pair a work computer before opening a conversation');
    markVolatileMessageOutbox(localMessageScope(profile.gatewayId, draft.conversationId, profile.deviceId));
    temporaryDrafts.set(key(draft.conversationId), structuredClone(draft));
    return;
  }
  storage.set(key(draft.conversationId), JSON.stringify(draft));
}

export function removeLocalSessionDraft(id: string): void { temporaryDrafts.delete(key(id)); storage.delete(key(id)); }

export function createLocalSessionDraft(creation: SessionCreation): string {
  const conversationId = randomUUID();
  saveLocalSessionDraft({ conversationId, creation, createdAt: new Date().toISOString() });
  return conversationId;
}

export function patchLocalSessionDraft(id: string, config: { model?: string; thinkingLevel?: string }): boolean {
  const draft = readLocalSessionDraft(id);
  if (!draft) return false;
  if (draft.clientMessageId || draft.materialization) throw new Error('The creation command is awaiting confirmation');
  if (config.model !== undefined) draft.creation.model = config.model;
  if (config.thinkingLevel !== undefined) draft.creation.thinkingLevel = config.thinkingLevel;
  saveLocalSessionDraft(draft);
  return true;
}
