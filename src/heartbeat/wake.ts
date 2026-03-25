export interface WakeRequest {
  reason?: string;
  agentId?: string;
  sessionKey?: string;
  coalesceMs?: number;
}

const DEFAULT_COALESCE_MS = 250;
const RETRY_MS = 1_000;

/**
 * Coalesces wake requests within coalesceMs and serializes handler execution.
 */
export function createHeartbeatWake(handler: (reasons: string[]) => Promise<void>) {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  let pendingReasons: string[] = [];

  function schedule(delayMs: number) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = undefined;
      if (running) {
        schedule(RETRY_MS);
        return;
      }
      running = true;
      const reasons = [...pendingReasons];
      pendingReasons = [];
      try {
        await handler(reasons);
      } finally {
        running = false;
        if (pendingReasons.length > 0) {
          schedule(DEFAULT_COALESCE_MS);
        }
      }
    }, delayMs);
    timer.unref?.();
  }

  return {
    request(opts?: WakeRequest) {
      pendingReasons.push(opts?.reason ?? 'interval');
      schedule(opts?.coalesceMs ?? DEFAULT_COALESCE_MS);
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      pendingReasons = [];
    },
  };
}
