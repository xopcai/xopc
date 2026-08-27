import { endpointTurnClaimSchema } from '@xopcai/endpoint-tools-protocol';
import type { Context } from 'hono';

import { validateWebchatAttachments, validateWebchatContent } from '../../chat-limits.js';
import type { UserTurnAttachment } from '../../user-turn-input.js';
import type { AuthenticatedRouteDeps } from './deps.js';

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
  const result = await deps.service.submitSessionInput({
    sessionKey,
    clientMessageId: typeof body.clientMessageId === 'string' ? body.clientMessageId : '',
    delivery,
    content,
    attachments: attachments as UserTurnAttachment[] | undefined,
    thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
    origin: { type: 'endpoint', endpointId: origin.data.endpointId },
  });
  if (result.ok === false) {
    return c.json(
      { ok: false, error: { code: result.code, message: 'Input was not accepted' } },
      result.code === 'QUEUE_FULL' ? 409 : 400,
    );
  }
  return c.json({ ok: true, payload: { ...result, sessionKey } }, 202);
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

  const result = await deps.service.replaceLatestSessionTurn({
    sessionKey,
    targetTurnId,
    clientMessageId: typeof body.clientMessageId === 'string' ? body.clientMessageId : '',
    delivery: 'next',
    content,
    attachments: attachments as UserTurnAttachment[] | undefined,
    thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
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
          : 'Replacement input was not accepted';
    return c.json({ ok: false, error: { code: result.code, message } }, status);
  }
  return c.json({ ok: true, payload: { ...result, sessionKey } }, 202);
}
