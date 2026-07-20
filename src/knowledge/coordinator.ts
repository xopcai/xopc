import { createLogger } from '../utils/logger.js';
import { ConnectedKnowledgePipeline, type ConnectedKnowledgePipelineOptions } from './connected-knowledge-pipeline.js';

const log = createLogger('ConnectedKnowledge:Coordinator');

export type ConnectedKnowledgeCoordinator = {
  runNow(): Promise<void>;
  stop(): void;
};

export function startConnectedKnowledgeCoordinator(options: {
  resolvePipelineOptions: () => ConnectedKnowledgePipelineOptions;
  intervalMs?: number;
  initialDelayMs?: number;
}): ConnectedKnowledgeCoordinator {
  const intervalMs = Math.max(10_000, Math.min(options.intervalMs ?? 60_000, 30 * 60_000));
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  async function runNow(): Promise<void> {
    if (running || stopped) return;
    running = true;
    try {
      const pipeline = new ConnectedKnowledgePipeline(options.resolvePipelineOptions());
      let processed = 0;
      for (let batch = 0; batch < 5; batch += 1) {
        const result = await pipeline.processPending();
        processed += result.claimed;
        if (result.claimed === 0) break;
      }
      if (processed > 0) {
        log.info({ processed }, 'Connected knowledge synthesis queue drained');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err }, `Connected knowledge coordinator failed: ${errorMessage}`);
    } finally {
      running = false;
    }
  }

  timer = setTimeout(() => {
    void runNow();
    timer = setInterval(() => void runNow(), intervalMs);
    timer.unref?.();
  }, Math.max(0, options.initialDelayMs ?? 2_000));
  timer.unref?.();

  return {
    runNow,
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
