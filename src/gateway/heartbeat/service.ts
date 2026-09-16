import { createConversation, resolveRoutedConversation } from '../../storage/sqlite/conversation-repository.js';
import { resolveDefaultAgentId } from '../../agent/agent-scope.js';
import { readFile } from 'fs/promises';

import { beginHeartbeatCheck, completeHeartbeatCheck, deliverHeartbeatChecks, recentHeartbeatChecks, recoverHeartbeatChecks } from './check-store.js';
import { proactiveChecksAllowed, proactivePreferences } from '../../proactive/policy/service.js';

import type { AgentService } from '../../agent/service.js';
import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { SessionStore } from '../../session/store.js';
import { appendCronEventLines } from '../../heartbeat/event-prompt.js';
import { isWithinActiveHours } from '../../heartbeat/active-hours.js';
import { isHeartbeatContentEmpty } from '../../heartbeat/content-check.js';
import {
  DEFAULT_ACK_MAX_CHARS,
  stripHeartbeatToken,
  shouldSilence,
} from '../../heartbeat/tokens.js';
import { createHeartbeatWake } from '../../heartbeat/wake.js';
import { createLogger } from '../../utils/logger.js';
import { resolveHeartbeatMdPath } from '../workspace-heartbeat-path.js';

const log = createLogger('HeartbeatService');

const DEFAULT_PROMPT =
  'Read HEARTBEAT.md if it exists. Follow it strictly. If nothing needs attention, reply HEARTBEAT_OK.';

export interface HeartbeatRunnerConfig {
  enabled: boolean;
  intervalMs: number;
  target?: string;
  targetChatId?: string;
  prompt?: string;
  ackMaxChars?: number;
  isolatedSession?: boolean;
  activeHours?: {
    start: string;
    end: string;
    timezone?: string;
  };
}

function mapConfigToRunner(cfg: Config | undefined): HeartbeatRunnerConfig {
  const h = cfg?.gateway?.heartbeat;
  return {
    enabled: h?.enabled ?? true,
    intervalMs: h?.intervalMs ?? 1_800_000,
    target: h?.target,
    targetChatId: h?.targetChatId,
    prompt: h?.prompt,
    ackMaxChars: h?.ackMaxChars,
    isolatedSession: h?.isolatedSession,
    activeHours: h?.activeHours,
  };
}

/** Map persisted gateway config to runner options (gateway start / reload). */
export function heartbeatRunnerConfigFromConfig(cfg: Config): HeartbeatRunnerConfig {
  return mapConfigToRunner(cfg);
}

export interface HeartbeatServiceDeps {
  agentService: AgentService;
  messageBus: MessageBus;
  sessionStore: SessionStore;
  /** Current app config (for HEARTBEAT.md path under the default agent `profile/` directory). */
  getConfig: () => Config;
  getWorkspace: () => string;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private wake: ReturnType<typeof createHeartbeatWake>;
  private nextCheckAt: string | null = null;
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private delivering = false;
  private recovered = false;
  private runnerConfig: HeartbeatRunnerConfig | null = null;

  constructor(private deps: HeartbeatServiceDeps) {
    this.wake = createHeartbeatWake(async reasons => {
      try { await this.runHeartbeatOnce(reasons); }
      catch (err) { log.error({ err }, 'Heartbeat check failed unexpectedly'); }
    });
  }

  start(config: HeartbeatRunnerConfig): void {
    if (this.runnerConfig) this.stop();
    if (!config.enabled) {
      log.info('Heartbeat disabled');
      this.runnerConfig = null;
      return;
    }

    this.runnerConfig = config;
    if (!this.recovered) { recoverHeartbeatChecks(this.deps.getWorkspace()); this.recovered = true; }
    this.deliveryTimer = setInterval(() => { void this.drainDeliveries().catch(err => log.warn({ err }, 'Heartbeat delivery check failed')); }, 10000);
    this.deliveryTimer.unref?.();
    this.nextCheckAt = new Date(Date.now() + config.intervalMs).toISOString();
    log.info({ intervalMs: config.intervalMs }, 'Heartbeat timer started (interval wake)');

    this.intervalId = setInterval(() => {
      this.nextCheckAt = new Date(Date.now() + config.intervalMs).toISOString();
      this.wake.request({ reason: 'interval' });
    }, config.intervalMs);
    this.intervalId.unref?.();
  }

  /** Cron, exec completion, manual triggers, etc. */
  requestNow(opts?: { reason?: string }): void {
    this.wake.request({ reason: opts?.reason ?? 'manual' });
  }

  stop(): void {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.deliveryTimer = null;
    this.nextCheckAt = null;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.wake.stop();
    this.runnerConfig = null;
    log.info('Heartbeat stopped');
  }

  updateConfig(config: Config): void {
    const mapped = mapConfigToRunner(config);
    this.stop();
    if (mapped.enabled) {
      this.start(mapped);
    }
    log.info('Heartbeat config updated');
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  status() {
    const preferences = proactivePreferences(this.deps.getWorkspace());
    return { enabled: Boolean(this.runnerConfig?.enabled), checksAllowed: proactiveChecksAllowed(preferences),
      nextCheckAt: proactiveChecksAllowed(preferences) ? this.nextCheckAt : null,
      recent: recentHeartbeatChecks(this.deps.getWorkspace()) };
  }

  private async drainDeliveries(): Promise<void> {
    if (this.delivering || !this.runnerConfig?.enabled) return;
    this.delivering = true;
    try { await deliverHeartbeatChecks(this.deps.getWorkspace(), this.deps.messageBus, this.runnerConfig.target?.trim(), this.runnerConfig.targetChatId?.trim()); }
    finally { this.delivering = false; }
  }

  private async runHeartbeatOnce(reasons: string[]): Promise<void> {
    const reasonSummary = [...new Set(reasons)].join(', ') || 'unknown';

    const cfg = this.runnerConfig;
    if (!cfg?.enabled) {
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (disabled)');
      return;
    }

    const preferences = proactivePreferences(this.deps.getWorkspace());
    if (!proactiveChecksAllowed(preferences)) return;
    if (cfg.activeHours && !isWithinActiveHours(cfg.activeHours)) {
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (outside active hours)');
      return;
    }

    const checkId = beginHeartbeatCheck(this.deps.getWorkspace());
    const heartbeatPath = resolveHeartbeatMdPath(this.deps.getConfig());
    if (!heartbeatPath) {
      completeHeartbeatCheck(checkId, 'blocked', 'No workspace checklist path');
      return;
    }
    let heartbeatContent: string | undefined;
    try {
      const raw = await readFile(heartbeatPath, 'utf-8');
      if (isHeartbeatContentEmpty(raw)) {
        completeHeartbeatCheck(checkId, 'empty_checklist');
        return;
      }
      heartbeatContent = raw.trim();
    } catch {
      completeHeartbeatCheck(checkId, 'blocked', 'Checklist could not be read');
      return;
    }

    const agentId = resolveDefaultAgentId(this.deps.getConfig());
    const conversationId = cfg.isolatedSession
      ? createConversation({ agentId, sourceChannel: 'heartbeat', sessionType: 'heartbeat' }).key
      : resolveRoutedConversation({ agentId, source: 'heartbeat', peerKind: 'direct', peerId: 'main' }, { sessionType: 'heartbeat' });

    let basePrompt = (cfg.prompt?.trim() || DEFAULT_PROMPT).trim();
    if (heartbeatContent) {
      basePrompt = `${basePrompt}\n\n---\nHEARTBEAT.md:\n${heartbeatContent}\n---`;
    }
    basePrompt = appendCronEventLines(basePrompt, reasons);
    basePrompt += "\nReturn notifications in your final response. Do not send messages, media or voice directly; delivery follows the user notification policy.";
    const prompt = `${basePrompt}\n\nCurrent time: ${new Date().toISOString()}`;

    const ackMax = cfg.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;

    log.debug({ conversationId, reasons: reasonSummary }, 'Heartbeat: invoking agent');

    // The shared heartbeat conversation is reused; each run would otherwise append to the transcript
    // until the model rejects the request (context window exceeded). Heartbeat prompts are
    // self-contained (HEARTBEAT.md + this turn's text), so we start from an empty history.
    if (!cfg.isolatedSession) {
      try {
        await this.deps.sessionStore.saveMessages(conversationId, [], {
          metadata: {
            sourceChannel: 'heartbeat',
            sourceChatId: 'main',
            sessionType: 'heartbeat',
            customData: { heartbeatTarget: 'main' },
            routing: {
              agentId,
              source: 'heartbeat',
              accountId: 'default',
              peerKind: 'direct',
              peerId: 'main',
            },
          },
        });
      } catch (err) {
        log.warn({ err, conversationId }, 'Heartbeat: failed to reset main session transcript');
      }
    }

    let reply: string;
    try {
      reply = await this.deps.agentService.turnDispatcher.processDirect(
        prompt,
        conversationId,
        { type: 'system', source: 'heartbeat' },
      );
    } catch (error) {
      completeHeartbeatCheck(checkId, 'failed', 'Agent check failed; see gateway logs');
      log.error({ err: error }, 'Heartbeat: agent call failed');
      return;
    }

    if (cfg !== this.runnerConfig || !proactiveChecksAllowed(proactivePreferences(this.deps.getWorkspace()))) {
      completeHeartbeatCheck(checkId, 'cancelled', 'Checks paused or configuration changed'); return;
    }
    if (!reply?.trim()) {
      completeHeartbeatCheck(checkId, 'no_change');
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (empty model reply)');
      return;
    }

    if (shouldSilence(reply, ackMax)) {
      completeHeartbeatCheck(checkId, 'no_change');
      log.info(
        { ackMax, replyChars: reply.length, reasons: reasonSummary },
        'Heartbeat: not sent — silent (HEARTBEAT_OK / short ack)',
      );
      return;
    }

    const { stripped } = stripHeartbeatToken(reply);
    const finalText = stripped || reply.trim();

    completeHeartbeatCheck(checkId, 'prepared', undefined, finalText, cfg.target?.trim(), cfg.targetChatId?.trim());
    await this.drainDeliveries();
  }
}
