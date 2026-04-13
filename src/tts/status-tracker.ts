import type { TtsRuntimeStatus, TtsStatusEntry } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS:StatusTracker');

const MAX_RECENT_ENTRIES = 20;

class TtsStatusTrackerImpl {
  private recentEntries: TtsStatusEntry[] = [];
  private totalCalls = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;

  recordAttempt(entry: TtsStatusEntry): void {
    this.recentEntries.push(entry);
    this.totalCalls += 1;

    if (entry.success) {
      this.totalSuccesses += 1;
    } else {
      this.totalFailures += 1;
    }

    if (this.recentEntries.length > MAX_RECENT_ENTRIES) {
      this.recentEntries.shift();
    }

    log.debug(
      {
        success: entry.success,
        provider: entry.provider,
        latencyMs: entry.latencyMs,
        totalCalls: this.totalCalls,
      },
      'TTS attempt recorded',
    );
  }

  getStatus(): TtsRuntimeStatus {
    const recentSuccesses = this.recentEntries.filter((e) => e.success).length;
    const recentTotal = this.recentEntries.length;

    return {
      lastAttempt:
        this.recentEntries.length > 0
          ? this.recentEntries[this.recentEntries.length - 1]
          : undefined,
      recentSuccessRate: recentTotal > 0 ? recentSuccesses / recentTotal : undefined,
      totalCalls: this.totalCalls,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
    };
  }

  getRecentEntries(count?: number): TtsStatusEntry[] {
    const limit = count ?? MAX_RECENT_ENTRIES;
    return this.recentEntries.slice(-limit);
  }

  reset(): void {
    this.recentEntries = [];
    this.totalCalls = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
  }
}

export const ttsStatusTracker = new TtsStatusTrackerImpl();

export function recordTtsSuccess(params: {
  provider: string;
  latencyMs: number;
  textLength: number;
  audioSize: number;
  audioFormat: string;
  usedFallback?: boolean;
  wasSummarized?: boolean;
}): void {
  ttsStatusTracker.recordAttempt({
    timestamp: Date.now(),
    success: true,
    ...params,
  });
}

export function recordTtsFailure(params: {
  provider?: string;
  latencyMs: number;
  textLength: number;
  error: string;
}): void {
  ttsStatusTracker.recordAttempt({
    timestamp: Date.now(),
    success: false,
    ...params,
  });
}
