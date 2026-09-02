import { apiFetch } from '../../api/client';

type AppStateLike = {
  addEventListener: (type: 'change', handler: (state: string) => void) => { remove: () => void };
};

const HEALTH_POLL_MS = 30_000;
let cachedAppState: AppStateLike | null | undefined;

function loadAppState(): AppStateLike | null {
  if (cachedAppState !== undefined) return cachedAppState;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred React Native import for unit tests
    cachedAppState = (require('react-native') as { AppState?: AppStateLike }).AppState ?? null;
  } catch {
    cachedAppState = null;
  }
  return cachedAppState;
}

export class GatewayHealthMonitor {
  private intervalId?: ReturnType<typeof setInterval>;
  private appStateSub?: { remove: () => void };
  private foreground = true;
  private online = true;
  private failures = 0;
  private listeners = new Set<(online: boolean) => void>();

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.online);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  async checkNow(): Promise<boolean> {
    try {
      const response = await apiFetch('/api/status', { timeoutMs: 5_000 });
      this.failures = 0;
      this.setOnline(response.ok);
    } catch {
      this.failures++;
      if (this.failures >= 2) this.setOnline(false);
    }
    return this.online;
  }

  private start(): void {
    void this.checkNow();
    this.intervalId = setInterval(() => {
      if (this.foreground) void this.checkNow();
    }, HEALTH_POLL_MS);
    const appState = loadAppState();
    this.appStateSub = appState?.addEventListener('change', (state) => {
      this.foreground = state === 'active';
      if (this.foreground) void this.checkNow();
    });
  }

  private stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.appStateSub?.remove();
    this.appStateSub = undefined;
  }

  private setOnline(value: boolean): void {
    if (this.online === value) return;
    this.online = value;
    for (const listener of this.listeners) listener(value);
  }
}

let monitor: GatewayHealthMonitor | null = null;
export function getGatewayHealthMonitor(): GatewayHealthMonitor {
  monitor ??= new GatewayHealthMonitor();
  return monitor;
}
