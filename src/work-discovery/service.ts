import { randomUUID } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getAgentDefaultModelRef } from '../config/schema.js';
import { ActivityService } from '../activity/service.js';
import type { ProjectService } from '../projects/project-service.js';
import { buildSessionKey } from '../routing/session-key.js';
import { getDefaultAgentId } from '../routing/resolve-route.js';
import type { SessionIndex } from '../session/manager.js';
import type { SessionMetadataSeed } from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';

import { analyzeWorkContext, workDiscoveryResultMarkdown } from './analyzer.js';
import {
  createWorkDiscoveryRun,
  getWorkDiscoveryOnboardingState,
  getWorkDiscoveryRun,
  getWorkDiscoveryRunByIdempotencyKey,
  setWorkDiscoveryFeedback,
  setWorkDiscoveryOnboardingState,
  updateWorkDiscoveryRun,
} from './repository.js';
import {
  probeWorkDiscoveryRoot,
  previewWorkDiscoveryRoot,
  summarizeWorkContextSnapshot,
  WORK_DISCOVERY_SCAN_POLICY_VERSION,
} from './probe.js';
import type {
  WorkDiscoveryErrorCode,
  WorkDiscoveryOnboardingState,
  WorkDiscoveryRecognitionDecision,
  WorkDiscoveryRun,
  WorkDiscoverySource,
} from './types.js';

const log = createLogger('WorkDiscovery');

export interface WorkDiscoveryServiceOptions {
  projects: ProjectService;
  sessions: SessionIndex;
  getConfig: () => Config;
  emit: (type: string, payload: unknown) => void;
}

function sessionMetadata(agentId: string, peerId: string): SessionMetadataSeed {
  return {
    sourceChannel: 'webchat',
    sourceChatId: ['default', 'direct', peerId].join(':'),
    sessionType: 'chat',
    hiddenFromSessionList: true,
    routing: {
      agentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    },
    customData: {
      workDiscovery: true,
      genericNewChatShell: false,
    },
  };
}

function errorCode(error: unknown): WorkDiscoveryErrorCode {
  if (error instanceof DOMException && error.name === 'AbortError') return 'canceled';
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('api key') || message.includes('model') || message.includes('provider')) return 'model_unavailable';
  if (message.includes('directory') || message.includes('folder') || message.includes('enoent')) return 'folder_unavailable';
  if (message.includes('permission') || message.includes('eacces')) return 'folder_not_readable';
  if (message.includes('json') || message.includes('analysis result')) return 'analysis_invalid';
  if (message.includes('timeout')) return 'analysis_timeout';
  return 'internal_error';
}

export class WorkDiscoveryService {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly activity = new ActivityService();

  constructor(private readonly options: WorkDiscoveryServiceOptions) {}

  isEnabled(): boolean {
    return this.options.getConfig().experimental?.workDiscoveryOnboarding === true;
  }

  getOnboardingState(): WorkDiscoveryOnboardingState {
    return getWorkDiscoveryOnboardingState();
  }

  dismissOnboarding(): WorkDiscoveryOnboardingState {
    return setWorkDiscoveryOnboardingState({ status: 'dismissed', activeRunId: null });
  }

  getRun(id: string): WorkDiscoveryRun | null {
    return getWorkDiscoveryRun(id);
  }

  async startRun(input: {
    rootPath: string;
    source: WorkDiscoverySource;
    idempotencyKey: string;
  }): Promise<WorkDiscoveryRun> {
    const existing = getWorkDiscoveryRunByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const config = this.options.getConfig();
    const modelRef = getAgentDefaultModelRef(config);
    if (!modelRef) throw new Error('No default model configured');

    const preview = await previewWorkDiscoveryRoot(input.rootPath);
    const rootPath = preview.canonicalRootPath;
    const agentId = getDefaultAgentId(config);
    const match = this.options.projects.resolveOrCreateForWorkspacePath({
      workspacePath: rootPath,
      defaultAgentId: agentId,
      autoCreate: true,
    });
    if (!match) throw new Error('Selected folder cannot be used as a project workspace');
    const projectAgentId = match.project.defaultAgentId || agentId;
    const peerId = `work-discovery-${randomUUID()}`;
    const sessionKey = buildSessionKey({
      agentId: projectAgentId,
      source: 'webchat',
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    });
    await this.options.sessions.saveMessages(sessionKey, [], {
      metadata: sessionMetadata(projectAgentId, peerId),
    });
    this.options.projects.attachSession(sessionKey, match.project.id);
    const now = Date.now();
    const run = createWorkDiscoveryRun({
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      status: 'queued',
      rootPath,
      projectId: match.project.id,
      sessionKey,
      agentId: projectAgentId,
      modelRef,
      scanPolicyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
      createdAt: now,
    });
    await this.options.sessions.appendTranscriptContextEntry(sessionKey, {
      text: 'Work discovery was explicitly requested for the selected folder.',
      data: {
        type: 'work_discovery',
        runId: run.id,
        rootPath,
        scanPolicyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
        source: input.source,
      },
    });
    if (input.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({ status: 'in_progress', activeRunId: run.id });
    }
    this.activity.record({
      type: 'work_discovery.started',
      primaryObject: { kind: 'project', id: match.project.id, title: match.project.name },
      actor: { kind: 'system' },
      initiator: { kind: 'user', sessionKey },
      source: { kind: 'gateway_api', runId: run.id },
      visibility: 'audit',
      payload: { policyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION, source: input.source },
      scopes: [
        { scopeKind: 'project', scopeId: match.project.id, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: sessionKey, reason: 'runtime_context' },
      ],
    });
    const controller = new AbortController();
    this.abortControllers.set(run.id, controller);
    void this.execute(run, controller.signal);
    return run;
  }

  private publish(run: WorkDiscoveryRun): void {
    const suffix = run.status === 'completed'
      ? 'completed'
      : run.status === 'failed'
        ? 'failed'
        : run.status === 'canceled'
          ? 'canceled'
          : 'progress';
    this.options.emit(`work-discovery.${suffix}`, {
      runId: run.id,
      projectId: run.projectId,
      sessionKey: run.sessionKey,
      status: run.status,
      stage: run.stage,
      ...(run.status === 'completed' ? { result: run.result } : {}),
    });
  }

  private async execute(run: WorkDiscoveryRun, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    try {
      let current = updateWorkDiscoveryRun(run.id, {
        status: 'probing',
        stage: 'folder_structure',
        startedAt,
      })!;
      this.publish(current);
      const snapshot = await probeWorkDiscoveryRoot(run.rootPath, signal);
      if (signal.aborted) throw new DOMException('Work discovery canceled', 'AbortError');
      current = updateWorkDiscoveryRun(run.id, {
        status: 'analyzing',
        stage: 'recent_progress',
        snapshot: summarizeWorkContextSnapshot(snapshot),
      })!;
      this.publish(current);
      const analysis = await analyzeWorkContext({ config: this.options.getConfig(), snapshot, signal });
      current = updateWorkDiscoveryRun(run.id, { status: 'analyzing', stage: 'next_steps' })!;
      this.publish(current);
      await this.options.sessions.appendTranscriptCustomMessageEntry(run.sessionKey, {
        customType: 'work-discovery-result',
        content: workDiscoveryResultMarkdown(analysis.result),
        display: true,
        details: { runId: run.id, result: analysis.result },
      });
      const project = this.options.projects.get(run.projectId);
      await this.options.sessions.updateSessionMetadata(run.sessionKey, {
        name: project ? `Continue work on ${project.name}` : 'Continue recent work',
        hiddenFromSessionList: false,
      });
      current = updateWorkDiscoveryRun(run.id, {
        status: 'completed',
        stage: 'next_steps',
        result: analysis.result,
        completedAt: Date.now(),
      })!;
      this.activity.record({
        type: 'work_discovery.completed',
        primaryObject: { kind: 'project', id: run.projectId, title: project?.name },
        actor: { kind: 'agent', agentId: run.agentId, sessionKey: run.sessionKey },
        initiator: { kind: 'user', sessionKey: run.sessionKey },
        source: { kind: 'system', runId: run.id },
        payload: {
          policyVersion: run.scanPolicyVersion,
          suggestionCount: analysis.result.suggestions.length,
          lowConfidence: analysis.result.lowConfidence === true,
        },
        scopes: [
          { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
          { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
        ],
      });
      this.publish(current);
      this.options.emit('session.transcript_updated', { key: run.sessionKey });
      log.info({ runId: run.id, projectId: run.projectId, sessionKey: run.sessionKey, durationMs: Date.now() - startedAt }, 'Work discovery completed');
    } catch (error) {
      const canceled = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      const code = canceled ? 'canceled' : errorCode(error);
      const message = canceled ? 'Analysis canceled' : error instanceof Error ? error.message : String(error);
      const current = updateWorkDiscoveryRun(run.id, {
        status: canceled ? 'canceled' : 'failed',
        errorCode: code,
        errorMessage: message,
        ...(canceled ? { canceledAt: Date.now() } : { completedAt: Date.now() }),
      });
      if (current) this.publish(current);
      this.activity.record({
        type: canceled ? 'work_discovery.canceled' : 'work_discovery.failed',
        primaryObject: { kind: 'project', id: run.projectId },
        actor: { kind: 'system' },
        initiator: { kind: 'user', sessionKey: run.sessionKey },
        source: { kind: 'system', runId: run.id },
        visibility: 'audit',
        payload: { errorCode: code },
        scopes: [
          { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
          { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
        ],
      });
      log.warn({ err: error, runId: run.id, projectId: run.projectId, phase: 'analysis', errorCode: code }, `Work discovery failed: ${message}`);
    } finally {
      this.abortControllers.delete(run.id);
    }
  }

  cancelRun(id: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(id);
    if (!run) return null;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'canceled') return run;
    this.abortControllers.get(id)?.abort();
    return updateWorkDiscoveryRun(id, {
      status: 'canceled',
      errorCode: 'canceled',
      errorMessage: 'Analysis canceled',
      canceledAt: Date.now(),
    });
  }

  retryRun(id: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(id);
    if (!run) return null;
    if (run.status !== 'failed' && run.status !== 'canceled') return run;
    const queued = updateWorkDiscoveryRun(id, {
      status: 'queued',
      stage: 'folder_structure',
      errorCode: undefined,
      errorMessage: undefined,
      completedAt: undefined,
      canceledAt: undefined,
    });
    if (!queued) return null;
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    if (run.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({ status: 'in_progress', activeRunId: id });
    }
    this.publish(queued);
    void this.execute(queued, controller.signal);
    return queued;
  }

  async submitRecognitionFeedback(input: {
    runId: string;
    decision: WorkDiscoveryRecognitionDecision;
    correctedIntent?: string;
  }): Promise<WorkDiscoveryRun | null> {
    const run = getWorkDiscoveryRun(input.runId);
    if (!run || run.status !== 'completed' || !run.result) return null;
    const correctedIntent = input.correctedIntent?.trim().slice(0, 2_000);
    if ((input.decision === 'corrected' || input.decision === 'different_goal') && !correctedIntent) {
      throw new Error('A corrected intent is required for this decision');
    }
    const feedback = setWorkDiscoveryFeedback({
      runId: run.id,
      recognitionDecision: input.decision,
      ...(correctedIntent ? { correctedIntent } : {}),
    });
    if (run.source === 'onboarding_selected_directory') {
      setWorkDiscoveryOnboardingState({
        status: input.decision === 'dismissed' ? 'dismissed' : 'completed',
        activeRunId: input.decision === 'dismissed' ? null : run.id,
      });
    }
    const feedbackText = correctedIntent
      ? `The user corrected the work discovery understanding: ${correctedIntent}`
      : input.decision === 'confirmed'
        ? 'The user confirmed the work discovery understanding.'
        : 'The user left work discovery without confirming the suggested understanding.';
    await this.options.sessions.appendTranscriptContextEntry(run.sessionKey, {
      text: feedbackText,
      data: {
        type: 'work_discovery_recognition_feedback',
        runId: run.id,
        decision: input.decision,
        ...(correctedIntent ? { correctedIntent } : {}),
      },
    });
    this.activity.record({
      type: `work_discovery.recognition_${input.decision}`,
      primaryObject: { kind: 'project', id: run.projectId },
      actor: { kind: 'user', sessionKey: run.sessionKey },
      source: { kind: 'gateway_api', runId: run.id },
      payload: {
        decision: input.decision,
        corrected: Boolean(correctedIntent),
      },
      scopes: [
        { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
      ],
    });
    this.options.emit('work-discovery.recognition-feedback', {
      runId: run.id,
      projectId: run.projectId,
      sessionKey: run.sessionKey,
      decision: input.decision,
    });
    return { ...run, feedback };
  }

  selectSuggestion(runId: string, suggestionId: string): WorkDiscoveryRun | null {
    const run = getWorkDiscoveryRun(runId);
    const suggestion = run?.result?.suggestions.find((item) => item.id === suggestionId);
    if (!run || !suggestion) return null;
    this.activity.record({
      type: 'work_discovery.suggestion_selected',
      primaryObject: { kind: 'project', id: run.projectId },
      actor: { kind: 'user', sessionKey: run.sessionKey },
      source: { kind: 'gateway_api', runId },
      payload: { suggestionId, title: suggestion.title },
      scopes: [
        { scopeKind: 'project', scopeId: run.projectId, reason: 'object_owner' },
        { scopeKind: 'session', scopeId: run.sessionKey, reason: 'runtime_context' },
      ],
    });
    return run;
  }
}
