import type { Outcome, OutcomeStartRequest, OutcomeStartResponse } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import type { ProjectService } from '../../projects/project-service.js';
import { resolveProjectAgentId } from '../../projects/project-agent.js';
import { buildSessionKey } from '../../routing/session-key.js';
import type { SessionIndex } from '../../session/index.js';
import type { SessionInputState } from '../../storage/sqlite/index.js';
import { defineOutcomeContract } from '../../work/outcome-contract-definition.js';
import { OutcomeExecutionService } from '../../work/outcome-execution-service.js';
import { OutcomeExecutionStateRepository } from '../../work/outcome-execution-state.js';
import { OutcomeRepository } from '../../work/outcome-repository.js';

type SubmitResult =
  | { ok: true; state: SessionInputState }
  | { ok: false; code: 'BAD_REQUEST' | 'QUEUE_FULL' };

export interface OutcomeStartDependencies {
  getConfig: () => Config;
  projects: ProjectService;
  sessions: SessionIndex;
  submit: (input: {
    sessionKey: string;
    clientMessageId: string;
    delivery: 'next';
    content: string;
  }) => Promise<SubmitResult>;
}

export class OutcomeStartService {
  readonly #outcomes = new OutcomeRepository();
  readonly #executions = new OutcomeExecutionStateRepository();
  readonly #execution = new OutcomeExecutionService();
  readonly #inflight = new Map<string, Promise<OutcomeStartResponse>>();

  constructor(private readonly deps: OutcomeStartDependencies) {}

  async start(input: OutcomeStartRequest): Promise<OutcomeStartResponse> {
    const inflight = this.#inflight.get(input.requestId);
    if (inflight) return inflight;
    const pending = this.startOnce(input);
    this.#inflight.set(input.requestId, pending);
    try {
      return await pending;
    } finally {
      if (this.#inflight.get(input.requestId) === pending) this.#inflight.delete(input.requestId);
    }
  }

  private async startOnce(input: OutcomeStartRequest): Promise<OutcomeStartResponse> {
    const objective = input.objective.trim();
    const existingExecution = this.#executions.getByRequestId(input.requestId);
    const existingOutcome = existingExecution && this.#outcomes.get(existingExecution.outcomeId);
    if (existingExecution && !existingOutcome) throw new Error('Outcome execution state is incomplete');
    if (existingExecution && (
      existingExecution.description !== objective
      || existingExecution.projectId !== input.projectId
      || (input.agentId !== undefined && existingExecution.agentId !== input.agentId)
      || existingExecution.uiLocale !== input.locale
    )) {
      throw new Error('requestId was already used for a different outcome');
    }
    if (!existingExecution && input.projectId && !this.deps.projects.get(input.projectId)) {
      throw new Error('Project not found');
    }

    const agentId = existingExecution?.agentId ?? resolveProjectAgentId({
      config: this.deps.getConfig(),
      projects: this.deps.projects,
      explicitAgentId: input.agentId,
      projectId: input.projectId,
    });
    const peerId = `outcome-start-${input.requestId}`;
    const sessionKey = existingExecution?.activeSessionKey ?? buildSessionKey({
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });

    const projectId = existingExecution?.projectId ?? input.projectId;
    await this.ensureSession({ sessionKey, peerId, agentId, projectId });
    const outcome = existingOutcome ?? this.createOutcome({ ...input, objective, sessionKey, agentId });
    await this.bindSession(sessionKey, outcome.id, projectId);

    const accepted = await this.deps.submit({
      sessionKey,
      clientMessageId: input.requestId,
      delivery: 'next',
      content: objective,
    });
    if (accepted.ok === false) {
      throw new Error(accepted.code === 'QUEUE_FULL'
        ? 'This outcome already has too much pending work'
        : 'The outcome could not be started');
    }

    return {
      ok: true,
      accepted: true,
      outcome,
      sessionKey,
      ...(accepted.state.activeRunId ? { runId: accepted.state.activeRunId } : {}),
    };
  }

  private async ensureSession(input: {
    sessionKey: string;
    peerId: string;
    agentId: string;
    projectId?: string;
  }): Promise<void> {
    if (await this.deps.sessions.getSessionMetadata(input.sessionKey)) return;
    await this.deps.sessions.saveMessages(input.sessionKey, [], {
      metadata: {
        sourceChannel: 'webchat',
        sourceChatId: `default:direct:${input.peerId}`,
        sessionType: 'chat',
        projectId: input.projectId,
        routing: {
          agentId: input.agentId,
          source: 'webchat',
          accountId: 'default',
          peerKind: 'direct',
          peerId: input.peerId,
        },
        customData: { origin: 'outcome', triggerKind: 'user' },
      },
    });
    if (input.projectId) this.deps.projects.attachSession(input.sessionKey, input.projectId);
  }

  private createOutcome(input: OutcomeStartRequest & {
    objective: string;
    sessionKey: string;
    agentId: string;
  }): Outcome {
    const contract = defineOutcomeContract(input.objective);
    const created = this.#execution.create({
      ...contract,
      requestId: input.requestId,
      description: input.objective,
      projectId: input.projectId,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      uiLocale: input.locale,
      source: 'api',
    });
    return this.#outcomes.get(created.outcomeId)!;
  }

  private async bindSession(sessionKey: string, outcomeId: string, projectId?: string): Promise<void> {
    const metadata = await this.deps.sessions.getSessionMetadata(sessionKey);
    await this.deps.sessions.updateSessionMetadata(sessionKey, {
      projectId: projectId ?? metadata?.projectId,
      customData: {
        ...metadata?.customData,
        outcomeId,
        origin: 'outcome',
        triggerKind: 'user',
      },
    });
  }
}
