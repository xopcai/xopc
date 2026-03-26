import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { HeartbeatSettingsState } from './heartbeat-settings.types';

export type { HeartbeatSettingsState } from './heartbeat-settings.types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeHeartbeatFromConfig(config: unknown): HeartbeatSettingsState {
  const c = isRecord(config) ? config : {};
  const gw = isRecord(c.gateway) ? c.gateway : {};
  const hb = isRecord(gw.heartbeat) ? gw.heartbeat : {};
  const ahRaw = hb.activeHours;
  const ah = isRecord(ahRaw) ? ahRaw : null;
  const activeHours =
    ah && typeof ah.start === 'string' && typeof ah.end === 'string' && ah.start && ah.end
      ? {
          start: ah.start,
          end: ah.end,
          timezone: typeof ah.timezone === 'string' ? ah.timezone : '',
        }
      : null;
  return {
    enabled: Boolean(hb.enabled ?? true),
    intervalMs: typeof hb.intervalMs === 'number' && Number.isFinite(hb.intervalMs) ? hb.intervalMs : 60000,
    target: typeof hb.target === 'string' ? hb.target : '',
    targetChatId: typeof hb.targetChatId === 'string' ? hb.targetChatId : '',
    prompt: typeof hb.prompt === 'string' ? hb.prompt : '',
    ackMaxChars:
      typeof hb.ackMaxChars === 'number' && Number.isFinite(hb.ackMaxChars) ? hb.ackMaxChars : '',
    isolatedSession: Boolean(hb.isolatedSession),
    activeHours,
  };
}

function buildHeartbeatPayload(state: HeartbeatSettingsState): Record<string, unknown> {
  const p: Record<string, unknown> = {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
  };
  if (state.target.trim()) p.target = state.target.trim();
  else p.target = null;
  if (state.targetChatId.trim()) p.targetChatId = state.targetChatId.trim();
  else p.targetChatId = null;
  if (state.prompt.trim()) p.prompt = state.prompt.trim();
  else p.prompt = null;
  if (state.ackMaxChars === '' || state.ackMaxChars === undefined) {
    p.ackMaxChars = null;
  } else {
    p.ackMaxChars = state.ackMaxChars;
  }
  if (state.isolatedSession) p.isolatedSession = true;
  else p.isolatedSession = null;
  if (state.activeHours?.start?.trim() && state.activeHours?.end?.trim()) {
    p.activeHours = {
      start: state.activeHours.start.trim(),
      end: state.activeHours.end.trim(),
      ...(state.activeHours.timezone.trim()
        ? { timezone: state.activeHours.timezone.trim() }
        : {}),
    };
  } else {
    p.activeHours = null;
  }
  return p;
}

export async function patchHeartbeatSettings(state: HeartbeatSettingsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      gateway: {
        heartbeat: buildHeartbeatPayload(state),
      },
    }),
  });
}

export async function fetchHeartbeatMd(): Promise<string> {
  const res = await fetchJson<{ ok?: boolean; payload?: { content?: string } }>(
    apiUrl('/api/workspace/heartbeat-md'),
  );
  return typeof res.payload?.content === 'string' ? res.payload.content : '';
}

export async function putHeartbeatMd(content: string): Promise<void> {
  await fetchJson(apiUrl('/api/workspace/heartbeat-md'), {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/** Queue one heartbeat run (same path as the interval timer). */
export async function triggerHeartbeat(reason?: string): Promise<void> {
  await fetchJson(apiUrl('/api/heartbeat/trigger'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
}
