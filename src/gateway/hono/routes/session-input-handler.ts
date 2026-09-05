import type { ModelThinkingValue } from '@xopcai/gateway-contract';
import { endpointTurnClaimSchema } from '@xopcai/endpoint-tools-protocol';
import type { Context } from 'hono';

import { withModelConfigLock } from '../../../session/model-config-lock.js';
import { getModelThinking } from '../../../providers/model-thinking.js';
import { resolveModel } from '../../../providers/index.js';
import { validateWebchatAttachments, validateWebchatContent } from '../../chat-limits.js';
import type { UserTurnAttachment } from '../../user-turn-input.js';
import { parseTurnContextRefs } from '../../../agent/source-context/types.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const MAX_TURN_CONTEXTS = 5;

export async function submitSessionInput(
  c: Context,
  deps: AuthenticatedRouteDeps,
  sessionKey: string,
) {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !sessionKey) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request' } }, 400);
  }
  const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
  const contextRefs = parseTurnContextRefs(body.contextRefs, MAX_TURN_CONTEXTS);
  if (contextRefs === null) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `contextRefs must contain at most ${MAX_TURN_CONTEXTS} valid notes` } }, 400);
  }
  const content = typeof body.content === 'string' ? body.content : '';
  const contentError = validateWebchatContent(content);
  if (contentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: contentError } }, 400);
  const attachmentError = validateWebchatAttachments(attachments);
  if (attachmentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: attachmentError } }, 400);
  const delivery = body.delivery === 'next' || body.delivery === 'steer' ? body.delivery : null;
  if (!delivery) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing delivery' } }, 400);
  const origin = endpointTurnClaimSchema.safeParse(body.origin);
  if (!origin.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint origin' } }, 400);
  if (!deps.service.endpointTools.registry.verifyTurnClaim(origin.data.endpointId, origin.data.token)) {
    return c.json({ ok: false, error: { code: 'INVALID_ENDPOINT', message: 'Endpoint connection is not active' } }, 401);
  }
  if (body.expectedSessionId !== undefined && (typeof body.expectedSessionId !== 'string' || !body.expectedSessionId || body.expectedSessionId.length > 128)) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session identity' } }, 400);
  }
  return withModelConfigLock(sessionKey, async () => {
    if (deps.service.voiceRealtime?.hasConversation(sessionKey)) {
      return c.json({ ok: false, error: { code: 'SESSION_BUSY', message: 'End the voice call before sending text' } }, 409);
    }
    const selection = body.configVersion !== undefined ? await deps.service.sessions.getAgentConfig(sessionKey) : undefined;
    if (selection) {
      if (!Number.isSafeInteger(body.configVersion) || selection.configVersion !== body.configVersion || !selection.fixedModel) {
        return c.json({ ok: false, error: { code: 'CONFIG_CHANGED', message: 'Model configuration changed. Refresh before sending.' } }, 409);
      }
      try {
        const capabilities = getModelThinking(resolveModel(selection.model));
        if (!capabilities.options.includes(selection.thinkingLevel as ModelThinkingValue)) {
          return c.json({ ok: false, error: { code: 'INVALID_THINKING', message: 'Select a supported thinking level before sending.' } }, 409);
        }
      } catch {
        return c.json({ ok: false, error: { code: 'MODEL_UNAVAILABLE', message: `Model unavailable: ${selection.model}` } }, 409);
      }
    }
    const result = await deps.service.submitSessionInput({
      expectedSessionId: body.expectedSessionId as string | undefined,
      sessionKey,
      clientMessageId: typeof body.clientMessageId === 'string' ? body.clientMessageId : '',
      delivery,
      content,
      attachments: attachments as UserTurnAttachment[] | undefined,
      contextRefs,
      thinking: selection?.thinkingLevel ?? (typeof body.thinking === 'string' ? body.thinking : undefined),
      origin: { type: 'endpoint', endpointId: origin.data.endpointId },
    });
    if (result.ok === false) {
      return c.json(
        { ok: false, error: { code: result.code, message: result.code === 'CONTEXT_UNAVAILABLE' ? 'A referenced Note changed or is no longer available. Select it again.' : 'Input was not accepted' } },
        result.code === 'SESSION_CHANGED' || result.code === 'QUEUE_FULL' || result.code === 'CONTEXT_UNAVAILABLE' ? 409 : 400,
      );
    }
    return c.json({ ok: true, payload: { ...result, sessionKey } }, 202);
  });
}

export async function replaceLatestSessionTurn(
  c: Context,
  deps: AuthenticatedRouteDeps,
  sessionKey: string,
  targetTurnId: string,
) {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !sessionKey || !targetTurnId) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request' } }, 400);
  }
  const attachments = Array.isArray(body.attachments) ? body.attachments : undefined;
  const contextRefs = parseTurnContextRefs(body.contextRefs, MAX_TURN_CONTEXTS);
  if (contextRefs === null) {
    return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `contextRefs must contain at most ${MAX_TURN_CONTEXTS} valid notes` } }, 400);
  }
  const content = typeof body.content === 'string' ? body.content : '';
  const contentError = validateWebchatContent(content);
  if (contentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: contentError } }, 400);
  const attachmentError = validateWebchatAttachments(attachments);
  if (attachmentError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: attachmentError } }, 400);
  const origin = endpointTurnClaimSchema.safeParse(body.origin);
  if (!origin.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid endpoint origin' } }, 400);
  if (!deps.service.endpointTools.registry.verifyTurnClaim(origin.data.endpointId, origin.data.token)) {
    return c.json({ ok: false, error: { code: 'INVALID_ENDPOINT', message: 'Endpoint connection is not active' } }, 401);
  }

  return withModelConfigLock(sessionKey, async () => {
    if (deps.service.voiceRealtime?.hasConversation(sessionKey)) {
      return c.json({ ok: false, error: { code: 'SESSION_BUSY', message: 'End the voice call before editing a turn' } }, 409);
    }
    const selection = body.configVersion !== undefined ? await deps.service.sessions.getAgentConfig(sessionKey) : undefined;
    if (selection) {
      if (!Number.isSafeInteger(body.configVersion) || selection.configVersion !== body.configVersion || !selection.fixedModel) {
        return c.json({ ok: false, error: { code: 'CONFIG_CHANGED', message: 'Model configuration changed. Refresh before sending.' } }, 409);
      }
      try {
        const capabilities = getModelThinking(resolveModel(selection.model));
        if (!capabilities.options.includes(selection.thinkingLevel as ModelThinkingValue)) {
          return c.json({ ok: false, error: { code: 'INVALID_THINKING', message: 'Select a supported thinking level before sending.' } }, 409);
        }
      } catch {
        return c.json({ ok: false, error: { code: 'MODEL_UNAVAILABLE', message: `Model unavailable: ${selection.model}` } }, 409);
      }
    }
    const result = await deps.service.replaceLatestSessionTurn({
      sessionKey,
      targetTurnId,
      clientMessageId: typeof body.clientMessageId === 'string' ? body.clientMessageId : '',
      delivery: 'next',
      content,
      attachments: attachments as UserTurnAttachment[] | undefined,
      contextRefs,
      thinking: selection?.thinkingLevel ?? (typeof body.thinking === 'string' ? body.thinking : undefined),
      origin: { type: 'endpoint', endpointId: origin.data.endpointId },
    });
    if (result.ok === false) {
      const status = result.code === 'TARGET_NOT_FOUND' ? 404 : result.code === 'BAD_REQUEST' ? 400 : 409;
      const message = result.code === 'NOT_LATEST'
        ? 'Only the latest user turn can be replaced'
        : result.code === 'SESSION_BUSY'
          ? 'Session has pending input'
        : result.code === 'TARGET_NOT_FOUND'
          ? 'User turn was not found'
          : result.code === 'CONTEXT_UNAVAILABLE'
            ? 'A referenced Note changed or is no longer available. Select it again.'
            : 'Replacement input was not accepted';
      return c.json({ ok: false, error: { code: result.code, message } }, status);
    }
    return c.json({ ok: true, payload: { ...result, sessionKey } }, 202);
  });
}
