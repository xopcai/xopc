import { z } from 'zod';

import { apiFetch, formatApiHttpError } from '../api/client';

export type ChatModelOption = {
  id: string;
  name?: string;
  description?: string;
};

export type ChatModelsPayload = {
  defaultId: string;
  items: ChatModelOption[];
};

const modelRowSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

function normalizeModelRow(raw: unknown): ChatModelOption | null {
  if (raw == null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string'
    ? row.id
    : typeof row.ref === 'string'
      ? row.ref
      : typeof row.modelRef === 'string'
        ? row.modelRef
        : '';
  if (!id.trim()) return null;
  const parsed = modelRowSchema.safeParse({ ...row, id: id.trim() });
  if (!parsed.success) return { id: id.trim() };
  return parsed.data;
}

function parseModelsPayload(raw: unknown): ChatModelsPayload | null {
  if (raw == null || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const payload = root.payload && typeof root.payload === 'object'
    ? (root.payload as Record<string, unknown>)
    : root;

  const listRaw = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(root.data)
        ? root.data
        : null;

  if (!listRaw) return null;

  const items: ChatModelOption[] = [];
  for (const row of listRaw) {
    const one = normalizeModelRow(row);
    if (one) items.push(one);
  }
  if (!items.length) return null;

  const defaultRaw = payload.defaultId ?? payload.defaultModelId ?? payload.defaultModelRef;
  const defaultId = typeof defaultRaw === 'string' && defaultRaw.trim()
    ? defaultRaw.trim()
    : items[0].id;

  return { defaultId, items };
}

export function resolveEffectiveModelId(
  payload: ChatModelsPayload | undefined,
  localOverride: string | null,
): string {
  const gatewayDefault = payload?.defaultId?.trim() || payload?.items[0]?.id || '';
  const items = payload?.items ?? [];
  const override = localOverride?.trim();
  if (override && items.some((m) => m.id === override)) return override;
  return gatewayDefault;
}

export async function fetchChatModels(agentId?: string): Promise<ChatModelsPayload> {
  const agentQ = agentId?.trim()
    ? `?agentId=${encodeURIComponent(agentId.trim().toLowerCase())}`
    : '';
  const res = await apiFetch(`/api/models${agentQ}`);
  if (res.status === 404 || res.status === 405 || res.status === 501) {
    const fallbackRes = await apiFetch(`/api/agent/models${agentQ}`);
    if (!fallbackRes.ok) {
      const body = (await fallbackRes.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(formatApiHttpError(fallbackRes.status, fallbackRes.statusText, body.error?.message));
    }
    const raw = await fallbackRes.json().catch(() => null);
    return parseModelsPayload(raw) ?? { defaultId: '', items: [] };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }

  const raw = await res.json().catch(() => null);
  return parseModelsPayload(raw) ?? { defaultId: '', items: [] };
}

export async function setSessionModelRef(sessionKey: string, modelRef: string): Promise<boolean> {
  const key = encodeURIComponent(sessionKey);
  const res = await apiFetch(`/api/sessions/${key}/agent-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelRef.trim() }),
  });
  if (res.ok) return true;
  const errBody = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(errBody.error ?? formatApiHttpError(res.status, res.statusText));
}

/** Fetch the session's agent-config (model override, thinking level, etc.). */
export async function fetchSessionAgentConfig(
  sessionKey: string,
): Promise<{ model: string; thinkingLevel: string }> {
  const key = encodeURIComponent(sessionKey);
  const res = await apiFetch(`/api/sessions/${key}/agent-config`);
  if (!res.ok) return { model: '', thinkingLevel: '' };
  const data = (await res.json().catch(() => ({}))) as {
    payload?: { model?: string; thinkingLevel?: string };
  };
  return {
    model: typeof data.payload?.model === 'string' ? data.payload.model : '',
    thinkingLevel: data.payload?.thinkingLevel ?? '',
  };
}
