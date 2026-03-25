import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { fetchConfiguredModelsCached } from '@/features/chat/registry-api';

/**
 * Whether the configured model supports extended thinking (matches `ui` `modelSupportsReasoning`).
 */
export async function modelSupportsReasoning(modelId: string): Promise<boolean> {
  const id = modelId.trim();
  if (!id) return false;
  try {
    const models = await fetchConfiguredModelsCached();
    const m = models.find((x) => x.id === id);
    return Boolean(m?.reasoning);
  } catch {
    return false;
  }
}
