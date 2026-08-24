import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { SideChatSelection, SideChatView } from './side-chat.types';

const CLIENT_KEY = 'xopc:side-chat-client-id';

export function getSideChatClientInstanceId(): string {
  const existing = sessionStorage.getItem(CLIENT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(CLIENT_KEY, id);
  return id;
}

function headers(): HeadersInit {
  return { 'x-xopc-client-instance-id': getSideChatClientInstanceId() };
}

export async function createSideChat(parentSessionKey: string, selections: SideChatSelection[]): Promise<SideChatView> {
  const response = await fetchJson<{ sideChat: SideChatView }>(
    apiUrl(`/api/sessions/${encodeURIComponent(parentSessionKey)}/side-chats`),
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ clientInstanceId: getSideChatClientInstanceId(), selections }),
    },
  );
  return response.sideChat;
}

export async function getSideChat(id: string): Promise<SideChatView> {
  const response = await fetchJson<{ sideChat: SideChatView }>(apiUrl(`/api/side-chats/${id}`), { headers: headers() });
  return response.sideChat;
}

export async function getSideChatMessages(id: string): Promise<unknown[]> {
  const response = await fetchJson<{ messages: unknown[] }>(apiUrl(`/api/side-chats/${id}/messages`), { headers: headers() });
  return response.messages;
}

export async function sendSideChatInput(id: string, content: string): Promise<string> {
  const response = await fetchJson<{ payload: { runId: string } }>(apiUrl(`/api/side-chats/${id}/inputs`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ content }),
  });
  return response.payload.runId;
}

export async function abortSideChat(id: string, runId?: string): Promise<void> {
  await fetchJson(apiUrl(`/api/side-chats/${id}/abort`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ runId }),
  });
}

export async function answerSideChatClarification(id: string, requestId: string, answer: string): Promise<void> {
  await fetchJson(apiUrl(`/api/side-chats/${id}/clarify/${requestId}`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ answer }),
  });
}

export async function deleteSideChat(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/side-chats/${id}`), { method: 'DELETE', headers: headers() });
}

export function heartbeatSideChat(id: string): void {
  void apiFetch(apiUrl(`/api/side-chats/${id}/heartbeat`), { method: 'POST', headers: headers() }).catch(() => {});
}

export function disposeSideChatClient(): void {
  const clientId = getSideChatClientInstanceId();
  void apiFetch(apiUrl(`/api/side-chats?clientInstanceId=${encodeURIComponent(clientId)}`), {
    method: 'DELETE',
    headers: headers(),
    keepalive: true,
  }).catch(() => {});
}
