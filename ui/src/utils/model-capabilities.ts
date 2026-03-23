import { apiUrl, authHeaders } from '../chat/helpers.js';

/**
 * Whether the configured model supports extended thinking / reasoning (UI may show thinking level).
 * Uses gateway GET /api/models (`reasoning` from model registry).
 */
export async function modelSupportsReasoning(modelId: string, token?: string): Promise<boolean> {
  const id = modelId.trim();
  if (!id) return false;
  try {
    const res = await fetch(apiUrl('/api/models'), { headers: authHeaders(token) });
    if (!res.ok) return false;
    const data = (await res.json()) as { payload?: { models?: Array<{ id: string; reasoning?: boolean }> } };
    const m = data.payload?.models?.find((x) => x.id === id);
    return Boolean(m?.reasoning);
  } catch {
    return false;
  }
}
