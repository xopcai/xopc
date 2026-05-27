import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { heartbeatMdSwrKey } from '@/features/settings/heartbeat-md-swr';
import { mutate } from 'swr';

import { callSetup } from './setup-api.js';
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
    intervalMs: typeof hb.intervalMs === 'number' && Number.isFinite(hb.intervalMs) ? hb.intervalMs : 1_800_000,
    includeSystemPromptSection: hb.includeSystemPromptSection === true,
    target: typeof hb.target === 'string' ? hb.target : '',
    targetChatId: typeof hb.targetChatId === 'string' ? hb.targetChatId : '',
    prompt: typeof hb.prompt === 'string' ? hb.prompt : '',
    ackMaxChars:
      typeof hb.ackMaxChars === 'number' && Number.isFinite(hb.ackMaxChars) ? hb.ackMaxChars : '',
    isolatedSession: Boolean(hb.isolatedSession),
    activeHours,
  };
}

export async function patchHeartbeatSettings(state: HeartbeatSettingsState): Promise<void> {
  await callSetup({
    domain: 'heartbeat',
    action: 'configure',
    fields: {
      enabled: state.enabled,
      intervalMs: state.intervalMs,
      includeSystemPromptSection: state.includeSystemPromptSection,
      target: state.target,
      targetChatId: state.targetChatId,
      prompt: state.prompt,
      ackMaxChars: state.ackMaxChars === '' ? null : state.ackMaxChars,
      isolatedSession: state.isolatedSession,
      activeHours: state.activeHours,
    },
  });
  void revalidateGatewayConfig();
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
  void mutate(heartbeatMdSwrKey());
}

/** Queue one heartbeat run (same path as the interval timer). */
export async function triggerHeartbeat(reason?: string): Promise<void> {
  await fetchJson(apiUrl('/api/heartbeat/trigger'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reason ? { reason } : {}),
  });
}
