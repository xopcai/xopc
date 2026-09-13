import { z } from 'zod';

/** Stable creation identity, independent of the client currently viewing a session. */
export const SESSION_SOURCE_CHANNELS = {
  workbench: ['webchat', 'web', 'ui', 'webui', 'gateway'],
  browser: ['browser_extension'],
  terminal: ['cli', 'tui'],
  telegram: ['telegram'],
  wechat: ['wechat', 'weixin'],
  feishu: ['feishu', 'lark'],
  api: ['api', 'mcp'],
  automation: ['automation', 'cron'],
  system: ['heartbeat', 'system'],
} as const;

export const SESSION_SOURCES = [...Object.keys(SESSION_SOURCE_CHANNELS), 'other'] as SessionSource[];
export type SessionSource = keyof typeof SESSION_SOURCE_CHANNELS | 'other';
export const SESSION_PURPOSES = ['chat', 'automation', 'workflow', 'subagent', 'system'] as const;
export type SessionPurpose = typeof SESSION_PURPOSES[number];

export interface SessionIdentityInput {
  sourceChannel: string;
  sessionType?: string;
  customData?: Record<string, unknown>;
}

export interface SessionDiscoveryQuery {
  sources?: SessionSource[];
  purposes?: SessionPurpose[];
  activity?: 'manual' | 'automatic';
  agentId?: string;
  excludeArchived?: boolean;
}

export const SessionDiscoveryQuerySchema = z.object({
  sources: z.array(z.enum(SESSION_SOURCES)).max(SESSION_SOURCES.length).optional(),
  purposes: z.array(z.enum(SESSION_PURPOSES)).max(SESSION_PURPOSES.length).optional(),
  activity: z.enum(['manual', 'automatic']).optional(),
  agentId: z.string().trim().min(1).max(128).optional(),
  excludeArchived: z.boolean().optional(),
});

export function resolveSessionIdentity(session: SessionIdentityInput): {
  source: SessionSource;
  purpose: SessionPurpose;
  automatic: boolean;
} {
  const channel = session.sourceChannel.trim().toLowerCase();
  const custom = session.customData ?? {};
  let source: SessionSource = 'other';
  for (const [name, aliases] of Object.entries(SESSION_SOURCE_CHANNELS)) {
    if ((aliases as readonly string[]).includes(channel)) source = name as SessionSource;
  }
  if (custom.createdSurface === 'browser_extension') source = 'browser';
  if (custom.origin === 'automation' || custom.triggerSource === 'automation' || session.sessionType === 'cron') source = 'automation';
  if (session.sessionType === 'heartbeat') source = 'system';
  const purpose: SessionPurpose = source === 'system' ? 'system'
    : session.sessionType === 'workflow-subagent' ? 'subagent'
    : session.sessionType === 'workflow-run' ? 'workflow'
    : source === 'automation' ? 'automation' : 'chat';
  return { source, purpose, automatic: source === 'automation' || source === 'system' };
}
