import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { effectiveProactivePolicy } from '../policy/service.js';
import { randomUUID } from 'node:crypto';

import { createLogger } from '../../utils/logger.js';
import { markReadyBatches } from '../routing/batch-repository.js';
import { composeScenarioPrompt } from '../scenarios/prompt-composer.js';
import { getPromptRevision, getScenario } from '../scenarios/repository.js';

import { ContextProviderRegistry } from './context.js';
import { isValuableInsight, parseAnalysisResult, scoreInsight } from './insight.js';
import { attachSnapshot, claimNextRun, eventIdsForBatch, failRun, finishRun, saveSnapshot } from './repository.js';
import type { ProactiveAgentExecutor } from './types.js';

const log = createLogger('ProactiveWorker');

export class ProactiveWorker {
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stoppedWaiters: Array<() => void> = [];

  constructor(
    private readonly executor: ProactiveAgentExecutor,
    private readonly contexts = new ContextProviderRegistry(),
    private readonly intervalMs = 5_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.running) return;
    await new Promise<void>((resolve) => this.stoppedWaiters.push(resolve));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      markReadyBatches();
      const run = claimNextRun(this.owner);
      if (!run) return;
      try {
        const scenario = getScenario(run.scenarioKey, run.scenarioVersion);
        if (!scenario) throw new Error('Pinned scenario version is unavailable');
        if (!effectiveProactivePolicy(run.subscriptionId).enabled) {
          finishRun({ run, rawOutput: '', outcomeReason: 'disabled' });
          return;
        }
        const revision = run.promptRevisionId ? getPromptRevision(run.promptRevisionId) ?? undefined : undefined;
        const eventIds = eventIdsForBatch(run.batchId);
        const context = await this.contexts.collect(scenario, { batchId: run.batchId, eventIds, subscriptionId: run.subscriptionId });
        if (context.evidenceIds.length === 0) {
          finishRun({ run, rawOutput: '', outcomeReason: 'source_unavailable' });
          return;
        }
        const snapshot = saveSnapshot(
          run.batchId,
          context.snapshotContent ?? context.content,
          context.evidenceIds,
        );
        attachSnapshot(run.id, snapshot.id);
        const prompt = composeScenarioPrompt({ scenario, ...(revision ? { revision } : {}), runtimeContext: 'Use the read-only inspection tool to examine the authorized evidence.' });
        const output = await this.executor.execute({ systemPrompt: prompt.platformSafety, userPrompt: prompt.text, authorizedContext: context.content });
        if (output.usage) getSqliteDatabase().prepare('UPDATE proactive_runs SET input_tokens = ?, output_tokens = ?, estimated_cost_usd = ? WHERE run_id = ? AND attempt = ?').run(output.usage.inputTokens, output.usage.outputTokens, output.usage.estimatedCostUsd ?? null, run.id, run.attempt);
        const latestContext = await this.contexts.collect(scenario, { batchId: run.batchId, eventIds, subscriptionId: run.subscriptionId });
        const revoked = context.evidenceIds.some((id) => !latestContext.evidenceIds.includes(id));
        const result = revoked ? { result: 'no_insight' as const, reason: 'source_unavailable' } : parseAnalysisResult(output.text, new Set(latestContext.evidenceIds));
        const candidate = result.result === 'insight' ? result.candidate : undefined;
        const valueScore = candidate ? scoreInsight(candidate) : 0;
        const enabled = effectiveProactivePolicy(run.subscriptionId).enabled;
        const valuable = enabled && candidate && isValuableInsight(candidate, scenario.valuePolicy);
        const insight = finishRun({
          run,
          ...(valuable ? { candidate, valueScore } : {}),
          cooldownSeconds: scenario.valuePolicy.cooldownSeconds,
          outcomeReason: !enabled ? 'disabled' : result.result === 'no_insight' ? result.reason : valuable ? 'insight' : 'below_threshold',
          rawOutput: revoked ? '' : output.text,
          modelRef: output.modelRef,
        });
        const disposition = insight ? 'created' : valuable ? 'duplicate_suppressed' : result.result === 'no_insight' ? result.reason : 'value_gate_discarded';
        log.info(
          { runId: run.id, scenarioKey: run.scenarioKey, disposition, insightId: insight?.id },
          insight ? 'Proactive insight created' : 'Proactive check completed without a card',
        );
      } catch (error) {
        const permanent = error instanceof Error && /Pinned scenario/.test(error.message);
        failRun(run, error, !permanent);
        log.warn({ err: error, runId: run.id, scenarioKey: run.scenarioKey }, 'Proactive run failed');
      }
    } finally {
      this.running = false;
      for (const resolve of this.stoppedWaiters.splice(0)) resolve();
    }
  }
}
