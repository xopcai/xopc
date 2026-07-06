/**
 * Online/offline state derived from probe-coordinator outcomes. Owns its
 * periodic foreground tick (so the coordinator stays a pure on-demand
 * primitive) and exposes a tiny pub/sub for hooks. Delegates the actual
 * race + caching to the coordinator — no parallel /health pings.
 */
import {
  getLastProbeOutcome,
  runProbeRound,
  subscribeProbeOutcome,
  type ProbeOutcome,
} from './probe-coordinator';
import { PROBE_TIMING } from './probe-timing';

type AppStateLike = {
  addEventListener: (
    type: 'change',
    handler: (state: string) => void,
  ) => { remove: () => void };
};

let cachedAppState: AppStateLike | null | undefined;
function loadAppState(): AppStateLike | null {
  if (cachedAppState !== undefined) return cachedAppState;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred RN import for vitest safety
    const rn = require('react-native') as { AppState?: AppStateLike };
    cachedAppState = rn.AppState ?? null;
  } catch {
    cachedAppState = null;
  }
  return cachedAppState;
}

const MAX_FAILURES_BEFORE_OFFLINE = 2;

export class GatewayHealthMonitor {
  private intervalId?: ReturnType<typeof setInterval>;
  private appStateSub?: { remove: () => void };
  private probeUnsub?: () => void;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private consecutiveFailures = 0;
  private online = true;
  private currentlyForeground = true;
  private readonly listeners = new Set<(online: boolean) => void>();

  subscribe(onStatusChange: (online: boolean) => void): () => void {
    this.listeners.add(onStatusChange);
    onStatusChange(this.online);
    this.startIfNeeded();

    return () => {
      this.listeners.delete(onStatusChange);
      if (this.listeners.size === 0) this.scheduleStop();
    };
  }

  private startIfNeeded(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
    }
    if (this.intervalId || this.probeUnsub) return;

    const seed = getLastProbeOutcome();
    if (seed) this.handleOutcome(seed);
    else void runProbeRound('initial');

    // Periodic foreground heartbeat. The coordinator dedupes within its own
    // freshness window, so this stays cheap when other triggers (network
    // change, focus, SSE failures) recently fired a probe. We skip ticks
    // entirely when the app is backgrounded — RN may keep the timer alive
    // for some interval, but the function exits early so we don't burn
    // battery probing while the user can't see the result.
    this.intervalId = setInterval(() => {
      if (!this.currentlyForeground) return;
      void runProbeRound('periodic');
    }, PROBE_TIMING.HEALTH_POLL_MS);

    this.probeUnsub = subscribeProbeOutcome((outcome) => this.handleOutcome(outcome));

    const appState = loadAppState();
    if (appState) {
      this.appStateSub = appState.addEventListener('change', (state: string) => {
        this.currentlyForeground = state === 'active';
        if (state === 'active') void runProbeRound('foreground');
      });
    }
  }

  private scheduleStop(): void {
    if (this.stopTimer) return;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = undefined;
      if (this.listeners.size === 0) this.stop();
    }, 250);
  }

  private stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.appStateSub?.remove();
    this.appStateSub = undefined;
    this.probeUnsub?.();
    this.probeUnsub = undefined;
    this.consecutiveFailures = 0;
  }

  private emit(online: boolean): void {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }

  private handleOutcome(outcome: ProbeOutcome): void {
    if (outcome.online) {
      if (!this.online) this.emit(true);
      this.consecutiveFailures = 0;
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_FAILURES_BEFORE_OFFLINE && this.online) {
      this.emit(false);
    }
  }

  /** Force an immediate probe (UI button). */
  async checkNow(): Promise<boolean> {
    const outcome = await runProbeRound('manual', { force: true });
    return outcome.online;
  }
}

let sharedMonitor: GatewayHealthMonitor | null = null;

export function getGatewayHealthMonitor(): GatewayHealthMonitor {
  if (!sharedMonitor) sharedMonitor = new GatewayHealthMonitor();
  return sharedMonitor;
}
