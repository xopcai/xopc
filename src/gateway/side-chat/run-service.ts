import { randomUUID } from 'node:crypto';

import type { AgentService } from '../../agent/service.js';
import { abortEmbeddedRun } from '../../agent/embedded/runs.js';
import { ChatStreamMapper } from '../chat-stream/mapper.js';
import type { ClarifyStreamEvent } from '../clarify-bridge.js';
import type { GatewayAgentRunner } from '../service/agent-runner.js';
import { SideChatError, type EphemeralSideChatManager } from './manager.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Gateway:SideChatRun');

interface ActiveSideChatRun {
  sideChatId: string;
  clientInstanceId: string;
  executionSessionKey: string;
  runId: string;
  abortController: AbortController;
}

export interface SideChatRunServiceOptions {
  manager: EphemeralSideChatManager;
  getAgentService: () => AgentService;
  agentRunner: GatewayAgentRunner;
  publishRealtime: (topic: string, event: string, data: unknown) => void;
  completeRealtimeTopic: (topic: string) => void;
}

export class SideChatRunService {
  private readonly activeBySideChat = new Map<string, ActiveSideChatRun>();

  constructor(private readonly options: SideChatRunServiceOptions) {}

  submit(sideChatId: string, clientInstanceId: string, content: string): { runId: string } {
    const text = content.trim();
    if (!text) throw new SideChatError('content is required', 'INVALID_REQUEST');
    const sideChat = this.options.manager.get(sideChatId, clientInstanceId);
    if (this.activeBySideChat.has(sideChatId)) {
      throw new SideChatError('A side chat run is already active', 'CONFLICT');
    }

    const run: ActiveSideChatRun = {
      sideChatId,
      clientInstanceId,
      executionSessionKey: this.options.manager.getRuntime(sideChatId, clientInstanceId).runtimeId,
      runId: randomUUID(),
      abortController: new AbortController(),
    };
    this.activeBySideChat.set(sideChatId, run);
    this.options.manager.setStatus(sideChatId, clientInstanceId, 'running');
    void this.execute(run, text, sideChat.config).catch((err) => {
      log.error({ err, sideChatId, runId: run.runId }, 'Side chat run cleanup failed');
    });
    return { runId: run.runId };
  }

  async abort(sideChatId: string, clientInstanceId: string, runId?: string): Promise<boolean> {
    this.options.manager.get(sideChatId, clientInstanceId);
    const active = this.activeBySideChat.get(sideChatId);
    if (!active || (runId && active.runId !== runId)) return false;
    this.options.agentRunner.cancelClarificationForRun(active.runId);
    active.abortController.abort();
    await abortEmbeddedRun(active.executionSessionKey).catch(() => false);
    return true;
  }

  async dispose(sideChatId: string, clientInstanceId: string): Promise<boolean> {
    await this.abort(sideChatId, clientInstanceId).catch(() => false);
    return this.options.manager.dispose(sideChatId, clientInstanceId);
  }

  submitClarification(sideChatId: string, clientInstanceId: string, requestId: string, answer: string): boolean {
    this.options.manager.get(sideChatId, clientInstanceId);
    return this.options.agentRunner.submitClarifyResponse(requestId, answer);
  }

  private async execute(
    run: ActiveSideChatRun,
    content: string,
    config: { modelRef: string; thinkingLevel?: import('@earendil-works/pi-agent-core').ThinkingLevel },
  ): Promise<void> {
    const topic = `run:${run.runId}`;
    const mapper = new ChatStreamMapper({
      runId: run.runId,
      sessionKey: run.sideChatId,
      channel: 'side-chat',
    });
    const publish = (event: ReturnType<ChatStreamMapper['start']>[number]) => {
      this.options.publishRealtime(topic, event.type, event);
    };
    const publishMapped = (event: { type: string; [key: string]: unknown }) => {
      for (const mapped of mapper.map(event)) publish(mapped);
    };

    try {
      for (const event of mapper.start()) publish(event);
      publishMapped({
        type: 'user_message',
        message: { role: 'user', content, timestamp: Date.now() },
      });
      this.options.agentRunner.registerExternalWebchatRun(
        run.executionSessionKey,
        run.runId,
        (event: ClarifyStreamEvent) => publishMapped(event),
      );
      const result = await this.options.getAgentService().runEphemeralTurn({
        executionSessionKey: run.executionSessionKey,
        parentSessionKey: this.options.manager.get(run.sideChatId, run.clientInstanceId).parentSessionKey,
        runId: run.runId,
        content,
        modelRef: config.modelRef,
        thinkingLevel: config.thinkingLevel,
        transcriptRuntime: this.options.manager.getRuntime(run.sideChatId, run.clientInstanceId),
        abortSignal: run.abortController.signal,
        onEvent: publishMapped,
      });
      const cancelled = run.abortController.signal.aborted;
      const status = cancelled ? 'cancelled' : result.ok ? 'success' : 'error';
      if (!result.ok && result.errorMessage) {
        for (const event of mapper.error(result.errorMessage)) publish(event);
      }
      for (const event of mapper.end(status, cancelled ? 'Interrupted' : result.errorMessage)) publish(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const event of mapper.error(message)) publish(event);
      for (const event of mapper.end('error', message)) publish(event);
    } finally {
      this.options.agentRunner.unregisterExternalWebchatRun(run.executionSessionKey, run.runId);
      this.activeBySideChat.delete(run.sideChatId);
      try {
        this.options.manager.getMessages(run.sideChatId, run.clientInstanceId);
        this.options.manager.setStatus(run.sideChatId, run.clientInstanceId, 'idle');
      } catch {
        // The side chat may have been closed while the run was stopping.
      }
      this.options.completeRealtimeTopic(topic);
    }
  }
}
