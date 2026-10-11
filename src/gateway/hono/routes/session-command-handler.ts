import type { Context } from 'hono';
import { conversationIdSchema, sessionInputCommandSchema, sessionMaterializeCommandSchema, parseUserTurnDocument, userTurnDocumentRefIds } from '@xopcai/gateway-contract';
import { endpointTurnClaimSchema } from '@xopcai/endpoint-tools-protocol';

import { deviceTurnSourceContext, endpointClaimBelongsToPrincipal } from '../../../endpoint-tools/turn-context.js';
import { browserPageContextToAgentContext } from '../../../agent/source-context/browser-page.js';
import { validateWebchatAttachments, validateWebchatContent } from '../../chat-limits.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { receiveSessionCommand, sessionCommandSnapshot } from '../../service/session-command-service.js';
import { getSessionInputReceipt, isConversationDeleted, SessionCommandError, retrySessionPreparation } from '../../../storage/sqlite/session-creation-repository.js';
import { z } from 'zod';
import type { AuthenticatedRouteDeps } from './deps.js';
import { parseSlashCommand, commandRegistry } from '../../../chat-commands/index.js';
import { isVoiceLikeAttachment } from '../../../channels/attachments/voice-stt-webchat.js';
import { createLogger } from '../../../utils/logger.js';

const log = createLogger('Gateway:SessionCommand');

function commandError(c: Context, error: unknown): Response {
  if (error instanceof SessionCommandError) {
    const status = error.code === 'BAD_REQUEST' ? 400 : error.code === 'SESSION_DELETED' ? 410 : error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409;
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, status);
  }
  throw error;
}

export async function handleSessionCommand(c: Context, deps: AuthenticatedRouteDeps, materialize = false) {
  const id = conversationIdSchema.safeParse(c.req.param('conversationId'));
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = materialize ? sessionMaterializeCommandSchema.safeParse(body) : sessionInputCommandSchema.safeParse(body);
  if (!id.success || !parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid session command' } }, 400);
  const command = parsed.data;
  const principal = getGatewayPrincipal(c);
  if ('input' in command) {
    const origin = command.origin.type === 'endpoint' ? endpointTurnClaimSchema.safeParse(command.origin) : null;
    if (origin && (!origin.success || !deps.service.endpointTools.registry.verifyTurnClaim(origin.data.endpointId, origin.data.token))) {
      return c.json({ ok: false, error: { code: 'INVALID_ENDPOINT', message: 'Endpoint connection is not active' } }, 401);
    }
    if (origin?.success && !endpointClaimBelongsToPrincipal(deps.service.endpointTools.registry, origin.data.endpointId, principal)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Endpoint does not belong to the authenticated device' } }, 403);
    }
    if (!origin && principal.kind !== 'owner') return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'CLI input requires owner authentication' } }, 403);
    if (command.input.browserContexts?.length && (!origin?.success || deps.service.endpointTools.registry.get(origin.data.endpointId)?.kind !== 'browser')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Browser context requires a browser endpoint' } }, 403);
    }
    const inputError = validateWebchatContent(command.input.content) ?? validateWebchatAttachments(command.input.attachments);
    if (inputError) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: inputError } }, 400);
    const document = parseUserTurnDocument(command.input.content);
    const refs = new Set((command.input.contextRefs ?? []).flatMap(ref => ref.refId ? [ref.refId] : []));
    if (document && !userTurnDocumentRefIds(document).every(ref => refs.has(ref))) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Input contains an unknown context reference' } }, 400);
    }
    const slash = parseSlashCommand(command.input.content);
    if (slash && commandRegistry.has(slash.command) && command.input.attachments?.some(attachment => !isVoiceLikeAttachment(attachment))) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Slash commands do not accept file or image attachments.' } }, 400);
    }
    if (!command.input.content.trim() && !command.input.attachments?.length && !command.input.contextRefs?.length && !command.input.browserContexts?.length && !command.input.appContext) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Input is empty' } }, 400);
    }
  }
  try {
    const payload = await receiveSessionCommand(deps.service, id.data, principal.principalId, command, async () => {
      if (!('input' in command)) return [];
      const endpoint = command.origin.type === 'endpoint' ? deps.service.endpointTools.registry.get(command.origin.endpointId) : undefined;
      const contexts = endpoint ? [deviceTurnSourceContext(endpoint, command.input.endpointContext)] : [];
      contexts.push(...(command.input.browserContexts ?? []).map(browserPageContextToAgentContext));
      if (command.input.appContext) contexts.push(await deps.service.prepareSessionAppContext(command.input.appContext, principal, id.data, command.clientMessageId));
      return contexts;
    });
    deps.service.emit('session.input-state', payload.inputState);
    if ('kind' in command && command.kind === 'start') deps.service.emit('session.updated', { key: id.data });
    if (payload.receipt.lifecycle === 'preparing') deps.service.sessionPreparations.wake(id.data);
    else if (payload.receipt.lifecycle === 'ready') void deps.service.drainSessionInputs(id.data).catch(err => {
      log.error({ err, conversationId: id.data }, 'Accepted session input drain failed');
    });
    return c.json({ ok: true, payload }, 202);
  } catch (error) { return commandError(c, error); }
}

export async function handleSessionInputReceipt(c: Context, deps: AuthenticatedRouteDeps) {
  const id = conversationIdSchema.safeParse(c.req.param('conversationId'));
  if (!id.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid conversation identity' } }, 400);
  try {
    const receipt = getSessionInputReceipt(id.data, c.req.param('clientMessageId'), getGatewayPrincipal(c).principalId);
    if (!receipt) return c.json({ ok: false, error: { code: 'NOT_RECEIVED', message: 'Input has not been received' } }, 404);
    if (isConversationDeleted(id.data)) return c.json({ ok: false, error: { code: 'SESSION_DELETED', message: 'Conversation was deleted' } }, 410);
    return c.json({ ok: true, payload: await sessionCommandSnapshot(deps.service, receipt) });
  } catch (error) { return commandError(c, error); }
}

const preparationRetrySchema = z.strictObject({ operationId: z.string().uuid(), expectedRevision: z.number().int().positive(), idempotencyKey: z.string().min(1).max(128) });
export async function handleSessionPreparationRetry(c: Context, deps: AuthenticatedRouteDeps) {
  const id = conversationIdSchema.safeParse(c.req.param('conversationId'));
  const parsed = preparationRetrySchema.safeParse(await c.req.json().catch(() => null));
  if (!id.success || !parsed.success) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid preparation retry' } }, 400);
  try {
    const preparation = retrySessionPreparation(id.data, getGatewayPrincipal(c).principalId, parsed.data);
    deps.service.sessionPreparations.wake(id.data);
    return c.json({ ok: true, payload: { preparation } }, 202);
  } catch (error) { return commandError(c, error); }
}
