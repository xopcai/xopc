import type { SessionCreation, SessionInputCommand, SessionMaterializeCommand, ModelThinkingValue } from '@xopcai/gateway-contract';

import type { AgentSourceContext } from '../../agent/source-context/types.js';
import { resolveProjectAgentId } from '../../projects/index.js';
import { resolveModel } from '../../providers/index.js';
import { getModelThinking } from '../../providers/model-thinking.js';
import { withModelConfigLock } from '../../session/model-config-lock.js';
import {
  acceptSessionCommand, getSessionPreparation, matchSessionInputReceipt, sessionCommandHash,
  SessionCommandError, type SessionInputReceipt,
} from '../../storage/sqlite/session-creation-repository.js';
import type { GatewayService } from '../service.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { getPersonalAgentByConversation } from '../../personal-agent/repository.js';
import { resolveEffectiveAgentConfigForAgent, resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';

function validateCreation(service: GatewayService, creation: SessionCreation): void {
  const project = creation.projectId ? service.projects.get(creation.projectId) : null;
  if (creation.projectId && !project) throw new Error('Project not found');
  const agentId = resolveProjectAgentId({ config: service.currentConfig, projects: service.projects,
    explicitAgentId: creation.agentId, projectId: creation.projectId ?? undefined });
  if (agentId !== creation.agentId) throw new Error('Invalid agent identity');
  if (project?.workspaceRoot?.trim() && !creation.execution) throw new Error('Select an execution environment');
  if (creation.execution && !project?.workspaceRoot?.trim()) throw new Error('Project requires a workspace');
  const model = resolveModel(creation.model);
  if (!getModelThinking(model).options.includes(creation.thinkingLevel as ModelThinkingValue)) throw new Error('Unsupported model thinking level');
}

export async function receiveSessionCommand(service: GatewayService, conversationId: string, principalId: string,
  command: SessionInputCommand | SessionMaterializeCommand,
  prepareSourceContexts: () => Promise<AgentSourceContext[]> = async () => []) {
  const receive = () => withModelConfigLock(conversationId, async () => {
    const personal = getPersonalAgentByConversation(conversationId);
    if (personal && 'creation' in command && command.creation.agentId !== personal.agentId) {
      throw new SessionCommandError('BAD_REQUEST', 'Personal AI identity is fixed');
    }
    const configuredThinking = ('creation' in command
      ? resolveEffectiveAgentConfigForAgent(command.creation.agentId)
      : resolveEffectiveAgentConfigForSession(conversationId)).config.runtime.thinkingLevel;
    if (configuredThinking && 'creation' in command && command.creation.thinkingLevel !== configuredThinking) {
      throw new SessionCommandError('BAD_REQUEST', `This agent uses thinking ${configuredThinking}`);
    }
    const clientMessageId = 'commandId' in command ? command.commandId : command.clientMessageId;
    const existing = matchSessionInputReceipt(conversationId, clientMessageId, principalId, sessionCommandHash(command));
    if (existing) return sessionCommandSnapshot(service, existing);
    if ('kind' in command && command.kind === 'append') {
      const session = getSessionMetadata(conversationId);
      if (!session) throw new SessionCommandError('NOT_FOUND', 'Conversation not found');
      if (session.transcriptId !== command.expectedTranscriptId) throw new SessionCommandError('SESSION_CHANGED', 'Conversation transcript changed');
    }
    if (service.voiceRealtime?.hasConversation(conversationId)) throw new SessionCommandError('SESSION_BUSY', 'End the voice call before sending text');
    if ('creation' in command) {
      try { validateCreation(service, command.creation); }
      catch (error) { throw new SessionCommandError('BAD_REQUEST', error instanceof Error ? error.message : 'Invalid creation configuration'); }
    }
    const preparedInput = 'input' in command ? await service.prepareSessionCommandInput({
      conversationId, clientMessageId, delivery: command.kind === 'start' ? 'next' : command.delivery,
      interrupt: command.kind === 'append' ? command.interrupt : undefined,
      content: command.input.content, attachments: command.input.attachments, contextRefs: command.input.contextRefs,
      sourceContexts: await prepareSourceContexts(),
      thinking: configuredThinking ?? (command.kind === 'start' ? command.creation.thinkingLevel : (await service.sessions.getAgentConfig(conversationId)).thinkingLevel),
      origin: command.origin.type === 'endpoint' ? { type: 'endpoint', endpointId: command.origin.endpointId } : command.origin,
    }) : undefined;
    const receipt = acceptSessionCommand({ conversationId, principalId, command, preparedInput,
      attachProject: (id, projectId) => service.projects.attachSession(id, projectId) });
    if ('kind' in command && command.kind === 'append' && receipt.inputId) {
      await service.dispatchAcceptedSessionInput(conversationId, receipt.inputId);
    }
    return sessionCommandSnapshot(service, receipt);
  });
  return service.withSessionInputSubmission(conversationId, receive);
}

export async function sessionCommandSnapshot(service: GatewayService, receipt: SessionInputReceipt) {
  const { principalId: _principal, requestHash: _hash, ...identity } = receipt;
  const inputState = service.getSessionInputState(receipt.conversationId);
  return {
    receipt: { ...identity, lifecycle: getSessionPreparation(receipt.conversationId)?.state ?? 'ready' },
    session: await service.sessions.getSession(receipt.conversationId),
    agentConfig: await service.sessions.getAgentConfig(receipt.conversationId),
    inputState,
    effectiveDelivery: inputState.inputs.find(input => input.id === receipt.inputId)?.effectiveDelivery ?? 'next',
    preparation: getSessionPreparation(receipt.conversationId),
  };
}
