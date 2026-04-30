import { useGatewayStore } from '../stores/gateway-store';
import { apiFetch, formatApiHttpError } from '../api/client';
import { sessionListItemSchema, sessionsListResponseSchema } from '../config/schema';

export type SessionListItem = {
  key: string;
  name?: string;
  messageCount: number;
  updatedAt: string;
  sourceChannel?: string;
};

export async function fetchSessionsList(): Promise<SessionListItem[]> {
  const res = await apiFetch('/api/sessions?limit=80&channel=webchat&sortBy=updatedAt&sortOrder=desc');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const raw = await res.json();
  const parsed = sessionsListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Invalid sessions response');
  }
  const items: SessionListItem[] = [];
  for (const row of parsed.data.items) {
    const one = sessionListItemSchema.safeParse(row);
    if (one.success) items.push(one.data);
  }
  return items;
}

export type SessionMessage = {
  role: string;
  content: unknown;
  timestamp?: string;
};

export type SessionDetail = {
  key: string;
  messages: SessionMessage[];
  name?: string;
};

export async function fetchSession(key: string): Promise<SessionDetail | null> {
  const enc = encodeURIComponent(key);
  const res = await apiFetch(`/api/sessions/${enc}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { session?: SessionDetail };
  return data.session ?? null;
}

export async function createSession(): Promise<string> {
  const res = await apiFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'webchat' }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { session?: { key?: string } };
  const key = data.session?.key;
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('Create session: missing key');
  }
  return key.trim();
}

export function useGatewayConfigured(): boolean {
  return useGatewayStore((s) => Boolean(s.baseUrl.trim()));
}
