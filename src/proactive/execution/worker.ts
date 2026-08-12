import { randomUUID } from 'node:crypto';

import { createLogger } from '../../utils/logger.js';
import { markReadyBatches } from '../routing/batch-repository.js';
import { composeScenarioPrompt } from '../scenarios/prompt-composer.js';
import { getPromptRevision, getScenario } from '../scenarios/repository.js';

import { ContextProviderRegistry } from './context.js';
import { isValuableInsight, parseInsightCandidate, scoreInsight } from './insight.js';
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
        const scenario = getScenario(run.scenarioKey);
        if (!scenario || scenario.version !== run.scenarioVersion) throw new Error('Pinned scenario version is unavailable');
        const revision = run.promptRevisionId ? getPromptRevision(run.promptRevisionId) ?? undefined : undefined;
        const eventIds = eventIdsForBatch(run.batchId);
        const context = await this.contexts.collect(run.scenarioKey, { batchId: run.batchId, eventIds, subscriptionId: run.subscriptionId });
        const snapshot = saveSnapshot(run.batchId, context, eventIds);
        attachSnapshot(run.id, snapshot.id);
        const prompt = composeScenarioPrompt({ scenario, ...(revision ? { revision } : {}), runtimeContext: 'Use the read-only inspection tool to examine the authorized evidence.' });
        const output = await this.executor.execute({ systemPrompt: prompt.platformSafety, userPrompt: prompt.text, authorizedContext: context });
        const candidate = parseInsightCandidate(output.text, new Set(eventIds));
        const valuable = isValuableInsight(candidate);
        const insight = finishRun({ run, ...(valuable ? { candidate, valueScore: scoreInsight(candidate) } : {}), rawOutput: output.text, modelRef: output.modelRef });
        log.info({ runId: run.id, scenarioKey: run.scenarioKey, valuable, insightId: insight?.id }, valuable ? 'Proactive insight created' : 'Proactive output discarded by value gate');
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
