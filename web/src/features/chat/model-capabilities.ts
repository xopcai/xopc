import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/**
 * Whether the configured model supports extended thinking (matches `ui` `modelSupportsReasoning`).
 */
export async function modelSupportsReasoning(modelId: string): Promise<boolean> {
  const id = modelId.trim();
  if (!id) return false;
  try {
    const res = await apiFetch(apiUrl('/api/models'));
    if (!res.ok) return false;
    const data = (await res.json()) as { payload?: { models?: Array<{ id: string; reasoning?: boolean }> } };
    const m = data.payload?.models?.find((x) => x.id === id);
    return Boolean(m?.reasoning);
  } catch {
    return false;
  }
}
