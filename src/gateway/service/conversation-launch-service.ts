import { createHash, randomUUID } from 'node:crypto';

import { canonicalSessionCommand, ConversationLaunchInputSchema, type ConversationLaunchInput, type ConversationLaunchContext } from '@xopcai/gateway-contract';

import { resolveEffectiveAgentConfigForAgent } from '../../config/agent-profile.js';
import { resolveProjectAgentId } from '../../projects/index.js';
import { resolveModel } from '../../providers/index.js';
import { getModelThinking } from '../../providers/model-thinking.js';
import { withModelConfigLock } from '../../session/model-config-lock.js';
import { findConversationLaunch, insertConversationLaunch, conversationLaunchView } from '../../storage/sqlite/conversation-launch-repository.js';
import { getSessionInputReceipt, isConversationDeleted, SessionCommandError } from '../../storage/sqlite/session-creation-repository.js';
import { getSessionMetadata, patchSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import type { SessionCommandHost } from './session-command-host.js';
import { validateWebchatContent } from '../chat-limits.js';
import { dispatchSessionCommand, receiveSessionCommand, sessionCommandSnapshot } from './session-command-service.js';

/** The context is supplied by the active Agent runtime, never from model arguments. */
export async function launchConversation(service: SessionCommandHost, raw: ConversationLaunchInput, context: ConversationLaunchContext) {
  const input = ConversationLaunchInputSchema.parse(raw);
  const error = validateWebchatContent(input.prompt);
  if (error) throw new SessionCommandError('BAD_REQUEST', error);
  if (!context.idempotencyKey.trim() || context.idempotencyKey.length > 128) throw new SessionCommandError('BAD_REQUEST', 'Invalid idempotency key');
  return withModelConfigLock(`conversation-launch:${context.sourceConversationId}`, async () => {
    const source = getSessionMetadata(context.sourceConversationId);
    if (!source?.transcriptId) throw new SessionCommandError('NOT_FOUND', 'Source conversation not found');
    const principalId = `agent:${source.agentId}`;
    const requestHash = createHash('sha256').update(canonicalSessionCommand(input)).digest('hex');
    const existing = findConversationLaunch(principalId, context.sourceConversationId, context.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new SessionCommandError('IDEMPOTENCY_CONFLICT', 'Launch identity was reused with different content');
      if (isConversationDeleted(existing.targetConversationId)) throw new SessionCommandError('SESSION_DELETED', 'Target conversation was deleted');
      const receipt = getSessionInputReceipt(existing.targetConversationId, existing.id, principalId);
      if (!receipt) throw new Error('Launch receipt is missing');
      if (!context.dryRun) dispatchSessionCommand(service, await sessionCommandSnapshot(service, receipt), true);
      return { ok: true as const, acceptance: 'accepted' as const, ...conversationLaunchView(existing) };
    }
    const projectId = input.project.kind === 'current' ? source.projectId
      : input.project.kind === 'project' ? input.project.projectId : undefined;
    const project = projectId ? service.projects.get(projectId) : undefined;
    if (projectId && !project) throw new SessionCommandError('NOT_FOUND', 'Project not found');
    if (input.execution && !project?.workspaceRoot?.trim()) throw new SessionCommandError('BAD_REQUEST', 'An execution environment requires a project workspace');
    const agentId = resolveProjectAgentId({ config: service.currentConfig, projects: service.projects, explicitAgentId: input.agentId, projectId });
    const effective = resolveEffectiveAgentConfigForAgent(agentId).config;
    const model = effective.models.chat.primary;
    const options = getModelThinking(resolveModel(model)).options;
    const thinkingLevel = effective.runtime.thinkingLevel ?? options[0];
    if (!thinkingLevel) throw new SessionCommandError('BAD_REQUEST', 'No supported thinking level');
    const creation = { agentId, projectId: projectId ?? null, temporary: false, model, thinkingLevel,
      execution: project?.workspaceRoot?.trim() ? input.execution ?? { mode: project.executionMode } : null };
    if (context.dryRun) return { ok: true as const, dryRun: true, creation };
    const id = randomUUID();
    const targetId = randomUUID();
    const title = input.title ?? input.prompt.replace(/\s+/g, ' ').slice(0, 80);
    const payload = await receiveSessionCommand(service, targetId, principalId, {
      kind: 'start', clientMessageId: id, creation, input: { content: input.prompt }, origin: { type: 'conversation', launchId: id },
    }, undefined, receipt => {
      const current = getSessionMetadata(context.sourceConversationId);
      if (current?.transcriptId !== source.transcriptId) throw new SessionCommandError('SESSION_CHANGED', 'Source conversation changed');
      // Check bounds under the same write lock as acceptance, including cross-process callers.
      const db = getSqliteDatabase();
      if (context.sourceRunId) {
        const turns = db.prepare('SELECT count(*) AS count FROM conversation_launches WHERE source_conversation_id=? AND source_run_id=?')
          .get(context.sourceConversationId, context.sourceRunId) as { count: number };
        if (turns.count >= 3) throw new SessionCommandError('BAD_REQUEST', 'Turn conversation launch limit reached');
      } else {
        const count = db.prepare('SELECT count(*) AS count FROM conversation_launches WHERE source_transcript_id=?')
          .get(source.transcriptId!) as { count: number };
        if (count.count >= 10) throw new SessionCommandError('BAD_REQUEST', 'Conversation launch limit reached');
      }
      let ancestor = context.sourceConversationId;
      let ancestorRun: string | null = context.sourceRunId ?? null;
      for (let depth = 0; ; depth++) {
        // Follow only the run started by each launch; a later human turn starts a fresh chain.
        const parent = db.prepare(`SELECT l.source_conversation_id AS id, l.source_run_id AS runId
          FROM conversation_launches l LEFT JOIN session_inputs i ON i.id=l.target_input_id
          WHERE l.target_conversation_id=? AND (? IS NULL OR i.run_id=?)`)
          .get(ancestor, ancestorRun, ancestorRun) as { id: string; runId: string | null } | undefined;
        if (!parent) break;
        if (depth >= 2) throw new SessionCommandError('BAD_REQUEST', 'Conversation launch depth limit reached');
        ancestor = parent.id;
        ancestorRun = parent.runId;
      }
      insertConversationLaunch({ id, principalId, sourceConversationId: context.sourceConversationId,
        sourceTranscriptId: source.transcriptId!, sourceRunId: context.sourceRunId ?? null, sourceAgentId: source.agentId, sourceToolCallId: context.toolCallId,
        targetConversationId: targetId, targetTranscriptId: receipt.transcriptId, targetInputId: receipt.inputId!,
        idempotencyKey: context.idempotencyKey, requestHash, title, projectId: projectId ?? null, createdAt: receipt.acceptedAt });
      patchSessionMetadata(targetId, { name: title });
    });
    dispatchSessionCommand(service, payload, true);
    const launch = findConversationLaunch(principalId, context.sourceConversationId, context.idempotencyKey)!;
    return { ok: true as const, acceptance: 'accepted' as const, ...conversationLaunchView(launch) };
  });
}
