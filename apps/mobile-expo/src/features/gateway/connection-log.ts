/**
 * Rolling buffer of the last N connection events — race outcomes, dual-fire
 * winners, apiFetch failures, SSE state changes. Surfaced in settings so the
 * user can copy them when reporting a problem, and used for any in-app
 * "what happened, why" diagnostics.
 *
 * Persisted to MMKV so events survive a restart (helpful for "it was broken
 * earlier this morning"). Capped at MAX_EVENTS to keep storage bounded.
 */
import { storage } from '../../storage/mmkv';

const STORAGE_KEY = 'gateway.connectionLog';
const MAX_EVENTS = 100;

export type ConnectionEventKind =
  | 'race'
  | 'dualFire'
  | 'apiFetch'
  | 'sse'
  | 'state';

export type ConnectionEvent = {
  at: number;
  kind: ConnectionEventKind;
  ok: boolean;
  url?: string;
  reason?: string;
  message?: string;
  latencyMs?: number;
  network?: string;
  route?: 'lan' | 'tunnel';
};

let buffer: ConnectionEvent[] | null = null;
const listeners = new Set<(events: ConnectionEvent[]) => void>();

function load(): ConnectionEvent[] {
  if (buffer) return buffer;
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return (buffer = []);
  try {
    const parsed = JSON.parse(raw) as ConnectionEvent[];
    buffer = Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  } catch {
    buffer = [];
  }
  return buffer;
}

function persist(): void {
  if (!buffer) return;
  try {
    storage.set(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    /* ignore quota errors */
  }
}

function emit(): void {
  const snapshot = buffer ? [...buffer] : [];
  for (const cb of listeners) cb(snapshot);
}

export function recordConnectionEvent(event: Omit<ConnectionEvent, 'at'>): void {
  const list = load();
  list.push({ ...event, at: Date.now() });
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  persist();
  emit();
}

export function readConnectionEvents(): ConnectionEvent[] {
  return [...load()];
}

export function clearConnectionEvents(): void {
  buffer = [];
  storage.delete(STORAGE_KEY);
  emit();
}

export function subscribeConnectionEvents(
  cb: (events: ConnectionEvent[]) => void,
): () => void {
  listeners.add(cb);
  cb(load().slice());
  return () => {
    listeners.delete(cb);
  };
}

/** @internal test helper */
export function __resetConnectionLogForTests(): void {
  buffer = null;
  listeners.clear();
}
