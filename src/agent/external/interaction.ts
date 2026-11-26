import { randomUUID } from 'node:crypto';
import {
  normalizeClarificationQuestion,
  normalizeClarificationSubmission,
  readClarificationPresentation,
  type ClarificationResponseAction,
  type ClarificationSubmission,
  type ClarificationWait,
  type ClarificationWaitSnapshot,
} from '@xopcai/gateway-contract';

import { currentDeviceExecutionActor, deviceExecutionPrincipalId } from '../../endpoint-tools/execution-actor.js';
import type { GatewayPrincipal } from '../../gateway/security/gateway-principal.js';
import { hasGatewayScope } from '../../gateway/security/gateway-scopes.js';
import type { ResolveClarificationResult } from '../../storage/sqlite/clarification-wait-repository.js';
import {
  isDangerousExternalCommand,
  isExternalApprovalRemembered,
  rememberExternalSessionApproval,
} from './approval-memory.js';
import type { ExternalInteractionRequest, ExternalInteractionResponse } from './types.js';

const APPROVAL_TTL_MS = 10 * 60_000;

export type ExternalClarifyStreamEvent = { type: string; [key: string]: unknown };

interface PendingExternalInteraction {
  id: string;
  conversationId: string;
  wait: ClarificationWait;
  actor?: GatewayPrincipal;
  request: ExternalInteractionRequest;
  normalizedQuestion: ReturnType<typeof normalizeClarificationQuestion>;
  streamEvent: ExternalClarifyStreamEvent;
  emitClarifyEvent: (event: ExternalClarifyStreamEvent) => void;
  resolve: (response: ExternalInteractionResponse) => void;
  onAbort: () => void;
  signal: AbortSignal;
  timer?: NodeJS.Timeout;
  activated: boolean;
  settled: boolean;
}

const pendingById = new Map<string, PendingExternalInteraction>();
const queueByConversation = new Map<string, PendingExternalInteraction[]>();

function buildClarificationWait(input: {
  id: string;
  conversationId: string;
  transcriptId: string;
  runId: string;
  actor?: GatewayPrincipal;
  request: ExternalInteractionRequest;
}): {
  wait: ClarificationWait;
  normalizedQuestion: ReturnType<typeof normalizeClarificationQuestion>;
  streamEvent: ExternalClarifyStreamEvent;
} {
  const now = Date.now();
  const req = input.request;
  const dangerousCommand = req.kind === 'approval' && req.actionKind === 'command' && isDangerousExternalCommand(req.question);
  const approvalDetail = req.kind === 'approval'
    ? [dangerousCommand ? '⚠️ High-risk command — review carefully before approving' : '', req.detail ?? '']
        .filter(Boolean)
        .join('\n')
    : '';
  const rawPayload = req.kind === 'approval'
    ? {
        kind: 'approval' as const,
        question: req.question,
        approval: {
          operation: req.title?.trim()
            || (req.actionKind === 'command'
              ? 'Run command'
              : req.actionKind === 'file_change'
                ? 'Modify files'
                : 'Approve action'),
          ...(approvalDetail ? { target: approvalDetail.slice(0, 2_000) } : {}),
        },
      }
    : {
        kind: 'input' as const,
        question: req.title
          ? `${req.title}: ${req.question}`
          : req.question,
        ...(req.choices?.length
          ? {
              choiceDetails: req.choices.slice(0, 10).map((choice) => ({
                id: choice.id,
                label: choice.label,
                ...(choice.description ? { description: choice.description } : {}),
              })),
            }
          : {}),
      };
  const normalizedQuestion = normalizeClarificationQuestion(rawPayload);
  const presentation = readClarificationPresentation(normalizedQuestion);
  const expiresAt = req.kind === 'approval' ? now + APPROVAL_TTL_MS : undefined;

  const wait: ClarificationWait = {
    id: input.id,
    principalId: input.actor?.principalId ?? 'external-runtime',
    conversationId: input.conversationId,
    transcriptId: input.transcriptId,
    objectiveId: input.runId,
    objectiveRevision: 1,
    originRunId: input.runId,
    originInputId: input.runId,
    originToolCallId: `external-interaction:${input.id}`,
    kind: req.kind === 'approval' ? 'approval' : 'input',
    question: normalizedQuestion.question,
    checkpoint: {
      objectiveSummary: normalizedQuestion.question,
      completedSteps: [],
      pendingSteps: [],
      originalRequestAt: now,
    },
    ...presentation,
    status: 'open',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...(expiresAt ? { expiresAt } : {}),
  };

  const streamEvent: ExternalClarifyStreamEvent = {
    type: 'clarify_request',
    requestId: input.id,
    ...presentation,
    kind: wait.kind,
    question: wait.question,
    version: wait.version,
    createdAt: wait.createdAt,
    ...(expiresAt ? { expiresAt } : {}),
  };

  return { wait, normalizedQuestion, streamEvent };
}

function defaultCancelledResponse(request: ExternalInteractionRequest): ExternalInteractionResponse {
  return request.kind === 'approval'
    ? { kind: 'approval', decision: 'deny' }
    : { kind: 'question', cancelled: true };
}

function activateHead(conversationId: string): void {
  const queue = queueByConversation.get(conversationId);
  if (!queue || queue.length === 0) {
    queueByConversation.delete(conversationId);
    return;
  }
  const head = queue[0];
  if (head.activated || head.settled) return;
  head.activated = true;
  if (head.wait.expiresAt) {
    const remainingMs = Math.max(1, head.wait.expiresAt - Date.now());
    head.timer = setTimeout(() => {
      settleEntry(head, defaultCancelledResponse(head.request));
    }, remainingMs);
    head.timer.unref?.();
  }
  head.emitClarifyEvent(head.streamEvent);
}

function settleEntry(entry: PendingExternalInteraction, response: ExternalInteractionResponse): void {
  if (entry.settled) return;
  entry.settled = true;
  if (entry.timer) clearTimeout(entry.timer);
  entry.signal.removeEventListener('abort', entry.onAbort);
  pendingById.delete(entry.id);

  const queue = queueByConversation.get(entry.conversationId);
  if (queue) {
    const idx = queue.indexOf(entry);
    if (idx !== -1) queue.splice(idx, 1);
    if (queue.length === 0) {
      queueByConversation.delete(entry.conversationId);
    } else if (idx === 0) {
      activateHead(entry.conversationId);
    }
  }

  entry.resolve(response);
}

/**
 * Pause an active external agent turn for a live approval or user-input prompt,
 * queuing concurrent prompts per conversation so each is presented cleanly via
 * xopc's standard `clarify_request` stream event.
 */
export function waitForExternalInteraction(input: {
  conversationId: string;
  transcriptId: string;
  runId: string;
  actor?: GatewayPrincipal;
  request: ExternalInteractionRequest;
  signal: AbortSignal;
  emitClarifyEvent: (event: ExternalClarifyStreamEvent) => void;
}): Promise<ExternalInteractionResponse> {
  if (input.signal.aborted) {
    return Promise.resolve(defaultCancelledResponse(input.request));
  }
  if (
    input.request.kind === 'approval'
    && isExternalApprovalRemembered(input.conversationId, input.transcriptId, input.request, input.actor?.principalId)
  ) {
    return Promise.resolve({ kind: 'approval', decision: 'approve' });
  }

  const id = randomUUID();
  const { wait, normalizedQuestion, streamEvent } = buildClarificationWait({
    id,
    conversationId: input.conversationId,
    transcriptId: input.transcriptId,
    runId: input.runId,
    actor: input.actor,
    request: input.request,
  });

  return new Promise<ExternalInteractionResponse>((resolve) => {
    const entry: PendingExternalInteraction = {
      id,
      conversationId: input.conversationId,
      wait,
      actor: input.actor,
      request: input.request,
      normalizedQuestion,
      streamEvent,
      emitClarifyEvent: input.emitClarifyEvent,
      resolve,
      onAbort: () => settleEntry(entry, defaultCancelledResponse(input.request)),
      signal: input.signal,
      activated: false,
      settled: false,
    };

    input.signal.addEventListener('abort', entry.onAbort, { once: true });
    pendingById.set(id, entry);

    const queue = queueByConversation.get(input.conversationId) ?? [];
    queue.push(entry);
    queueByConversation.set(input.conversationId, queue);
    activateHead(input.conversationId);
  });
}

export function getActiveExternalInteractionSnapshot(conversationId: string): ClarificationWaitSnapshot | undefined {
  const head = queueByConversation.get(conversationId)?.[0];
  if (!head || head.settled) return undefined;
  return {
    transcriptId: head.wait.transcriptId,
    revision: head.wait.version,
    serverTime: Date.now(),
    clarification: head.wait,
  };
}

export function hasExternalInteraction(id: string): boolean {
  return pendingById.has(id);
}

export function canAccessExternalInteraction(id: string, actor: GatewayPrincipal | undefined): boolean {
  const pending = pendingById.get(id);
  if (!pending?.actor || !actor || !hasGatewayScope(actor.scopes, 'workspace.write')) return false;
  const current = currentDeviceExecutionActor(pending.conversationId, pending.wait.originRunId);
  return current?.principalId === pending.actor.principalId
    && current.principalId === deviceExecutionPrincipalId(actor)
    && hasGatewayScope(current.scopes, 'workspace.write');
}

export function resolveExternalInteraction(
  input: ClarificationSubmission & {
    id: string;
    expectedVersion?: number;
    action: ClarificationResponseAction;
  },
): ResolveClarificationResult | undefined {
  const pending = pendingById.get(input.id);
  if (!pending) return undefined;

  if (input.expectedVersion !== undefined && pending.wait.version !== input.expectedVersion) {
    return { ok: false, code: 'CONFLICT', clarification: pending.wait };
  }
  if (pending.wait.expiresAt !== undefined && pending.wait.expiresAt <= Date.now()) {
    settleEntry(pending, defaultCancelledResponse(pending.request));
    return { ok: false, code: 'EXPIRED', clarification: { ...pending.wait, status: 'expired' } };
  }

  if (input.action === 'cancel') {
    const cancelledWait: ClarificationWait = {
      ...pending.wait,
      status: 'cancelled',
      resolution: 'cancelled',
      version: pending.wait.version + 1,
      updatedAt: Date.now(),
      resolvedAt: Date.now(),
    };
    settleEntry(pending, defaultCancelledResponse(pending.request));
    return { ok: true, clarification: cancelledWait, idempotent: false, queued: false };
  }

  if (pending.request.kind === 'approval') {
    const rememberForSession = input.response?.choiceId === 'approve_session';
    const choice = input.response?.choiceId;
    const decision = input.decision ?? (choice === 'deny' ? 'deny' : choice === 'approve' || choice === 'approve_session' ? 'approve' : undefined);
    if (decision !== 'approve' && decision !== 'deny') {
      return { ok: false, code: 'INVALID', clarification: pending.wait };
    }
    if (decision === 'approve' && rememberForSession) {
      rememberExternalSessionApproval(pending.conversationId, pending.wait.transcriptId, pending.request, pending.actor?.principalId);
    }
    const answeredWait: ClarificationWait = {
      ...pending.wait,
      status: 'resolved',
      resolution: 'answered',
      decision,
      version: pending.wait.version + 1,
      updatedAt: Date.now(),
      resolvedAt: Date.now(),
    };
    settleEntry(pending, { kind: 'approval', decision });
    return { ok: true, clarification: answeredWait, idempotent: false, queued: false };
  }

  let normalized: ReturnType<typeof normalizeClarificationSubmission>;
  try {
    const submission: ClarificationSubmission = {
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
      ...(input.answers !== undefined ? { answers: input.answers } : {}),
      ...(input.response !== undefined ? { response: input.response } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
    };
    normalized = normalizeClarificationSubmission(pending.normalizedQuestion, submission);
  } catch {
    return { ok: false, code: 'INVALID', clarification: pending.wait };
  }
  const answeredWait: ClarificationWait = {
    ...pending.wait,
    status: 'resolved',
    resolution: 'answered',
    answer: normalized.answer,
    response: input.response,
    version: pending.wait.version + 1,
    updatedAt: Date.now(),
    resolvedAt: Date.now(),
  };
  settleEntry(pending, {
    kind: 'question',
    choiceId: input.response?.choiceId,
    text: normalized.answer,
  });
  return { ok: true, clarification: answeredWait, idempotent: false, queued: false };
}

export function cancelExternalInteractionsForConversation(conversationId: string): void {
  const queue = queueByConversation.get(conversationId);
  if (!queue) return;
  for (const entry of [...queue]) {
    settleEntry(entry, defaultCancelledResponse(entry.request));
  }
}
