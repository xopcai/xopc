import type { Context } from 'hono';

import { withModelConfigLock } from '../../../session/model-config-lock.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export async function patchChatModelConfig(
  c: Context,
  service: AuthenticatedRouteDeps['service'],
  sessionKey: string,
  body: Record<string, unknown>,
) {
  return withModelConfigLock(sessionKey, async () => {
    const changesModel = body.model !== undefined || body.thinkingLevel !== undefined;
    if (changesModel) {
      const state = service.getSessionInputState(sessionKey);
      if (service.sessions.getActiveRun(sessionKey).active || state.activeRunId || state.inputs.length > 0) {
        return c.json({ ok: false, error: 'Wait for the current reply and pending inputs to finish', code: 'SESSION_BUSY' }, 409);
      }
      if (body.thinkingLevel !== undefined && typeof body.thinkingLevel !== 'string') {
        return c.json({ ok: false, error: 'Invalid thinking level' }, 400);
      }
      if (body.configVersion !== undefined && (!Number.isSafeInteger(body.configVersion) || Number(body.configVersion) < 0)) {
        return c.json({ ok: false, error: 'Invalid configuration version' }, 400);
      }
      if (body.model !== undefined && (typeof body.model !== 'string' || !body.model.trim())) {
        return c.json({ ok: false, error: 'Select a specific model' }, 400);
      }
    }
    const result = await service.sessions.patchAgentConfig(sessionKey, { ...body, ...(changesModel ? { fixedModel: true } : {}) });
    if (!result.ok) return c.json({ ok: false, error: result.error, code: result.code }, result.code === 'CONFIG_CHANGED' ? 409 : 400);
    return c.json({ ok: true, payload: await service.sessions.getAgentConfig(sessionKey) });
  });
}
