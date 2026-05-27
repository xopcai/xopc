import type { Config } from '../schema.js';

export interface HeartbeatActiveHoursFields {
  start: string;
  end: string;
  timezone?: string;
}

export interface HeartbeatPatchFields {
  enabled?: boolean;
  intervalMs?: number;
  includeSystemPromptSection?: boolean;
  target?: string;
  targetChatId?: string;
  prompt?: string;
  ackMaxChars?: number | '' | null;
  isolatedSession?: boolean;
  activeHours?: HeartbeatActiveHoursFields | null;
}

export function buildHeartbeatConfig(fields: HeartbeatPatchFields): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (fields.enabled !== undefined) p.enabled = fields.enabled;
  if (fields.intervalMs !== undefined) p.intervalMs = fields.intervalMs;
  if (fields.includeSystemPromptSection !== undefined) {
    p.includeSystemPromptSection = fields.includeSystemPromptSection;
  }
  if (fields.target !== undefined) {
    p.target = fields.target.trim() ? fields.target.trim() : null;
  }
  if (fields.targetChatId !== undefined) {
    p.targetChatId = fields.targetChatId.trim() ? fields.targetChatId.trim() : null;
  }
  if (fields.prompt !== undefined) {
    p.prompt = fields.prompt.trim() ? fields.prompt.trim() : null;
  }
  if (fields.ackMaxChars !== undefined) {
    if (fields.ackMaxChars === '' || fields.ackMaxChars === null) {
      p.ackMaxChars = null;
    } else {
      p.ackMaxChars = fields.ackMaxChars;
    }
  }
  if (fields.isolatedSession !== undefined) {
    p.isolatedSession = fields.isolatedSession ? true : null;
  }
  if (fields.activeHours !== undefined) {
    if (fields.activeHours?.start?.trim() && fields.activeHours?.end?.trim()) {
      p.activeHours = {
        start: fields.activeHours.start.trim(),
        end: fields.activeHours.end.trim(),
        ...(fields.activeHours.timezone?.trim()
          ? { timezone: fields.activeHours.timezone.trim() }
          : {}),
      };
    } else {
      p.activeHours = null;
    }
  }
  return p;
}

export function applyHeartbeatPatch(cfg: Config, fields: HeartbeatPatchFields): Config {
  const gateway = { ...((cfg.gateway ?? {}) as Record<string, unknown>) };
  const existing =
    gateway.heartbeat && typeof gateway.heartbeat === 'object'
      ? (gateway.heartbeat as Record<string, unknown>)
      : {};

  const merged: HeartbeatPatchFields = {
    enabled: typeof existing.enabled === 'boolean' ? existing.enabled : true,
    intervalMs:
      typeof existing.intervalMs === 'number' && Number.isFinite(existing.intervalMs)
        ? existing.intervalMs
        : 1_800_000,
    includeSystemPromptSection: existing.includeSystemPromptSection === true,
    target: typeof existing.target === 'string' ? existing.target : '',
    targetChatId: typeof existing.targetChatId === 'string' ? existing.targetChatId : '',
    prompt: typeof existing.prompt === 'string' ? existing.prompt : '',
    ackMaxChars:
      typeof existing.ackMaxChars === 'number' && Number.isFinite(existing.ackMaxChars)
        ? existing.ackMaxChars
        : '',
    isolatedSession: existing.isolatedSession === true,
    activeHours:
      existing.activeHours &&
      typeof existing.activeHours === 'object' &&
      typeof (existing.activeHours as HeartbeatActiveHoursFields).start === 'string' &&
      typeof (existing.activeHours as HeartbeatActiveHoursFields).end === 'string'
        ? (existing.activeHours as HeartbeatActiveHoursFields)
        : null,
    ...fields,
  };

  gateway.heartbeat = buildHeartbeatConfig(merged);
  return { ...cfg, gateway } as Config;
}
