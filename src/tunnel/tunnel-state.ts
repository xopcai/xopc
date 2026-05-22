import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';
import type { PersistedTunnelState } from './tunnel-types.js';

const TUNNEL_STATE_FILE = 'tunnel.json';

export function resolveTunnelStatePath(): string {
  return join(resolveStateDir(), TUNNEL_STATE_FILE);
}

export function loadTunnelState(): PersistedTunnelState | null {
  const path = resolveTunnelStatePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as PersistedTunnelState;
    if (!parsed.tunnelId || !parsed.tunnelToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTunnelState(state: PersistedTunnelState): void {
  const path = resolveTunnelStatePath();
  mkdirSync(resolveStateDir(), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function updateTunnelState(patch: Partial<PersistedTunnelState>): PersistedTunnelState | null {
  const current = loadTunnelState();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveTunnelState(next);
  return next;
}

export function clearTunnelState(): void {
  const path = resolveTunnelStatePath();
  if (existsSync(path)) {
    writeFileSync(path, '{}\n', 'utf8');
  }
}
