import { readFile } from 'fs/promises';
import { join } from 'path';

import type { AgentService } from '../../agent/service.js';
import type { Config } from '../../config/schema.js';
import { CronService } from '../../cron/service.js';
import type { MessageBus } from '../../infra/bus/index.js';
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

const log = createLogger('HeartbeatService');

const DEFAULT_PROMPT =
  'Read HEARTBEAT.md if it exists. Follow it strictly. If nothing needs attention, reply HEARTBEAT_OK.';

const HEARTBEAT_FILENAME = 'HEARTBEAT.md';

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
    intervalMs: h?.intervalMs ?? 60000,
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
  cronService: CronService;
  workspacePath: string;
}

export class HeartbeatService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private wake: ReturnType<typeof createHeartbeatWake>;
  private lastHeartbeatText = '';
  private lastHeartbeatAt = 0;
  private runnerConfig: HeartbeatRunnerConfig | null = null;

  constructor(private deps: HeartbeatServiceDeps) {
    this.wake = createHeartbeatWake((reasons) => this.runHeartbeatOnce(reasons));
  }

  start(config: HeartbeatRunnerConfig): void {
    if (!config.enabled) {
      log.info('Heartbeat disabled');
      this.runnerConfig = null;
      return;
    }

    this.runnerConfig = config;
    log.info({ intervalMs: config.intervalMs }, 'Heartbeat timer started (interval wake)');

    this.intervalId = setInterval(() => {
      this.wake.request({ reason: 'interval' });
    }, config.intervalMs);
    this.intervalId.unref?.();
  }

  /** Cron, exec completion, manual triggers, etc. */
  requestNow(opts?: { reason?: string }): void {
    this.wake.request({ reason: opts?.reason ?? 'manual' });
  }

  stop(): void {
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

  private async runHeartbeatOnce(reasons: string[]): Promise<void> {
    const reasonSummary = [...new Set(reasons)].join(', ') || 'unknown';

    const cfg = this.runnerConfig;
    if (!cfg?.enabled) {
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (disabled)');
      return;
    }

    try {
      const metrics = await this.deps.cronService.getMetrics();
      log.trace(
        { runningJobs: metrics.runningJobs, enabledJobs: metrics.enabledJobs },
        'Heartbeat: cron metrics',
      );
    } catch {
      /* optional */
    }

    if (cfg.activeHours && !isWithinActiveHours(cfg.activeHours)) {
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (outside active hours)');
      return;
    }

    const heartbeatPath = join(this.deps.workspacePath, HEARTBEAT_FILENAME);
    try {
      const raw = await readFile(heartbeatPath, 'utf-8');
      if (isHeartbeatContentEmpty(raw)) {
        log.debug({ path: heartbeatPath, reasons: reasonSummary }, 'Heartbeat: skip (HEARTBEAT.md empty)');
        return;
      }
    } catch {
      log.debug({ path: heartbeatPath, reasons: reasonSummary }, 'Heartbeat: HEARTBEAT.md missing; continuing');
    }

    const sessionKey = cfg.isolatedSession
      ? `heartbeat:isolated:${Date.now()}`
      : 'heartbeat:main';

    let basePrompt = (cfg.prompt?.trim() || DEFAULT_PROMPT).trim();
    basePrompt = appendCronEventLines(basePrompt, reasons);
    const prompt = `${basePrompt}\n\nCurrent time: ${new Date().toISOString()}`;

    const ackMax = cfg.ackMaxChars ?? DEFAULT_ACK_MAX_CHARS;

    log.debug({ sessionKey, reasons: reasonSummary }, 'Heartbeat: invoking agent');

    let reply: string;
    try {
      reply = await this.deps.agentService.processDirect(prompt, sessionKey);
    } catch (error) {
      log.error({ err: error }, 'Heartbeat: agent call failed');
      return;
    }

    if (!reply?.trim()) {
      log.debug({ reasons: reasonSummary }, 'Heartbeat: skip (empty model reply)');
      return;
    }

    if (shouldSilence(reply, ackMax)) {
      log.info(
        { ackMax, replyChars: reply.length, reasons: reasonSummary },
        'Heartbeat: not sent — silent (HEARTBEAT_OK / short ack)',
      );
      return;
    }

    const { stripped } = stripHeartbeatToken(reply);
    const finalText = stripped || reply.trim();

    if (this.isDuplicate(finalText)) {
      log.info(
        { finalTextChars: finalText.length, reasons: reasonSummary },
        'Heartbeat: not sent — duplicate within 24h',
      );
      return;
    }

    const target = cfg.target?.trim();
    const targetChatId = cfg.targetChatId?.trim();
    const hasDeliveryTarget = Boolean(target && targetChatId);

    if (hasDeliveryTarget) {
      await this.deps.messageBus.publishOutbound({
        channel: target!,
        chat_id: targetChatId!,
        content: finalText,
        type: 'message',
      });
      log.info(
        {
          reasons: reasonSummary,
          channel: target,
          chatId: targetChatId,
          contentChars: finalText.length,
        },
        'Heartbeat: sent — outbound queued',
      );
    } else {
      log.info(
        { reasons: reasonSummary, finalTextChars: finalText.length },
        'Heartbeat: not sent — no delivery target (set gateway.heartbeat.target + targetChatId)',
      );
    }

    this.lastHeartbeatText = finalText;
    this.lastHeartbeatAt = Date.now();
  }

  private isDuplicate(text: string): boolean {
    const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
    return (
      text.trim() === this.lastHeartbeatText.trim() &&
      Date.now() - this.lastHeartbeatAt < DEDUP_WINDOW_MS
    );
  }
}
