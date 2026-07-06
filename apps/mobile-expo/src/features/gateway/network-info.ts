/**
 * Network adapter — gives the rest of the app a stable identifier for the
 * current network and a way to subscribe to changes. We use this to:
 *  - skip LAN probes on cellular (LAN address can never be reachable),
 *  - key the per-network "last good route" cache so jumping between home
 *    Wi-Fi, work Wi-Fi, and cellular each remembers its own winner.
 *
 * `@react-native-community/netinfo` is NOT a project dependency; we
 * lazy-require it so the optimization works the moment it's installed
 * and degrades gracefully when it's not. Without NetInfo we still get
 * the per-profile cache and AppState-driven re-probe.
 *
 * NOTE: react-native's `AppState` is also lazy-required so this module is
 * safe to import from non-RN test environments.
 */
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- avoid RN import at module init for tests
    const rn = require('react-native') as { AppState?: AppStateLike };
    cachedAppState = rn.AppState ?? null;
  } catch {
    cachedAppState = null;
  }
  return cachedAppState;
}

export type NetworkKind = 'wifi' | 'cellular' | 'ethernet' | 'unknown' | 'offline';

export type NetworkSnapshot = {
  /** Stable string used as a cache key. */
  key: string;
  kind: NetworkKind;
  /** True when the device has any kind of internet path. */
  online: boolean;
};

const UNKNOWN: NetworkSnapshot = { key: 'unknown', kind: 'unknown', online: true };

type NetInfoState = {
  type?: string;
  isConnected?: boolean | null;
  details?: { ssid?: string | null; cellularGeneration?: string | null } | null;
};

type NetInfoModule = {
  fetch: () => Promise<NetInfoState>;
  addEventListener: (cb: (s: NetInfoState) => void) => () => void;
};

let netInfo: NetInfoModule | null | undefined;

function loadNetInfo(): NetInfoModule | null {
  if (netInfo !== undefined) return netInfo;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native dep, lazy
    netInfo = require('@react-native-community/netinfo') as NetInfoModule;
  } catch {
    netInfo = null;
  }
  return netInfo;
}

function snapshotFromState(state: NetInfoState | undefined): NetworkSnapshot {
  if (!state) return UNKNOWN;
  const online = state.isConnected !== false;
  const type = (state.type ?? 'unknown').toLowerCase();
  let kind: NetworkKind = 'unknown';
  if (type === 'wifi') kind = 'wifi';
  else if (type === 'cellular') kind = 'cellular';
  else if (type === 'ethernet') kind = 'ethernet';
  else if (type === 'none' || !online) kind = 'offline';

  let suffix = 'none';
  if (kind === 'wifi') {
    const ssid = state.details?.ssid?.trim();
    suffix = ssid ? `ssid:${hashString(ssid)}` : 'unknown-ssid';
  } else if (kind === 'cellular') {
    suffix = state.details?.cellularGeneration?.toString().toLowerCase() ?? 'cell';
  } else if (kind === 'ethernet') {
    suffix = 'eth';
  } else if (kind === 'offline') {
    suffix = 'offline';
  }

  return { key: `${kind}:${suffix}`, kind, online: kind !== 'offline' };
}

/** Stable, non-cryptographic 32-bit hash. We never need to recover the SSID. */
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

let current: NetworkSnapshot = UNKNOWN;
let initPromise: Promise<NetworkSnapshot> | null = null;

/**
 * Refresh once. Multiple concurrent callers share the same in-flight request
 * so the very first fetch on cold start (which several parts of the app race
 * for) hits the OS only once.
 */
export async function refreshNetworkSnapshot(): Promise<NetworkSnapshot> {
  const mod = loadNetInfo();
  if (!mod) return current;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const state = await mod.fetch();
      current = snapshotFromState(state);
    } catch {
      /* keep previous */
    } finally {
      initPromise = null;
    }
    return current;
  })();
  return initPromise;
}

/**
 * Refresh with a wallclock cap. Used at app start so we always continue past
 * a slow OS query within a few hundred ms.
 */
export async function refreshNetworkSnapshotWithDeadline(
  maxMs: number,
): Promise<NetworkSnapshot> {
  return Promise.race([
    refreshNetworkSnapshot(),
    new Promise<NetworkSnapshot>((resolve) => setTimeout(() => resolve(current), maxMs)),
  ]);
}

export function getNetworkSnapshot(): NetworkSnapshot {
  return current;
}

export function isLikelyLanReachable(): boolean {
  if (current.kind === 'cellular' || current.kind === 'offline') return false;
  return true;
}

type Listener = (snap: NetworkSnapshot) => void;
const listeners = new Set<Listener>();
let started = false;
let unsubNetInfo: (() => void) | undefined;
let unsubAppState: { remove: () => void } | undefined;

function emit(): void {
  for (const cb of listeners) cb(current);
}

function start(): void {
  if (started) return;
  started = true;
  void refreshNetworkSnapshot().then(emit);

  const mod = loadNetInfo();
  if (mod) {
    unsubNetInfo = mod.addEventListener((state) => {
      const next = snapshotFromState(state);
      if (next.key === current.key && next.online === current.online) return;
      current = next;
      emit();
    });
  }

  const appState = loadAppState();
  if (appState) {
    const onAppState = (s: string) => {
      if (s === 'active') {
        void refreshNetworkSnapshot().then((snap) => {
          emit();
          void snap;
        });
      }
    };
    unsubAppState = appState.addEventListener('change', onAppState);
  }
}

function stopIfIdle(): void {
  if (listeners.size > 0) return;
  started = false;
  if (unsubNetInfo) {
    unsubNetInfo();
    unsubNetInfo = undefined;
  }
  if (unsubAppState) {
    unsubAppState.remove();
    unsubAppState = undefined;
  }
}

export function subscribeNetworkChange(cb: Listener): () => void {
  listeners.add(cb);
  start();
  cb(current);
  return () => {
    listeners.delete(cb);
    stopIfIdle();
  };
}

/** @internal test hook */
export function __setNetworkSnapshotForTests(snap: NetworkSnapshot): void {
  current = snap;
  emit();
}

/** @internal test hook */
export function __resetNetworkInfoForTests(): void {
  listeners.clear();
  started = false;
  unsubNetInfo?.();
  unsubAppState?.remove();
  unsubNetInfo = undefined;
  unsubAppState = undefined;
  netInfo = undefined;
  current = UNKNOWN;
}
