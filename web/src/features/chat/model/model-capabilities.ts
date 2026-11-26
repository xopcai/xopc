import { fetchAgentRuntimeModelsCached, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';

/**
 * Whether the configured model supports extended thinking (matches `ui` `modelSupportsReasoning`).
 */
export async function modelSupportsReasoning(modelId: string, externalAgentId?: string): Promise<boolean> {
  const id = modelId.trim();
  if (!id && !externalAgentId) return false;
  try {
    if (externalAgentId) {
      const payload = await fetchAgentRuntimeModelsCached(externalAgentId);
      const matched = payload.models.find((x) => x.id === id)
        ?? payload.models.find((x) => x.id === payload.defaultModel)
        ?? payload.models[0];
      return Boolean(matched?.reasoning || (matched?.thinking && matched.thinking.mode !== 'none'));
    }
    const models = await fetchConfiguredModelsCached();
    const m = models.find((x) => x.id === id);
    return Boolean(m?.reasoning);
  } catch {
    return false;
  }
}
