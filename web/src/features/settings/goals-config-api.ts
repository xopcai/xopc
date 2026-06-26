import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type GoalsConfigState = {
  maxTurns: number;
  judgeModelRef: string;
  checklistMode: boolean;
  checklistDecomposePolicy: 'empty_only' | 'supplement_existing';
  maxConsecutiveParseFailures: number;
  judgeTimeoutSec: number;
  checklistHistoryChars: number;
  notifications: {
    enabled: boolean;
    includeLinkedSessions: boolean;
    channels: string[];
    events: string[];
    targets: Array<{
      channel: string;
      chatId: string;
      accountId?: string;
      threadId?: string | number;
      silent?: boolean;
      events?: string[];
    }>;
  };
};

const DEFAULT_GOALS_CONFIG: GoalsConfigState = {
  maxTurns: 20,
  judgeModelRef: '',
  checklistMode: true,
  checklistDecomposePolicy: 'empty_only',
  maxConsecutiveParseFailures: 3,
  judgeTimeoutSec: 60,
  checklistHistoryChars: 24_000,
  notifications: {
    enabled: false,
    includeLinkedSessions: true,
    channels: ['telegram', 'weixin'],
    events: ['done', 'blocked', 'needs_input', 'queue_failed', 'queue_retry'],
    targets: [],
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeGoalsConfigFromConfig(config: unknown): GoalsConfigState {
  const c = isRecord(config) ? config : {};
  const goals = isRecord(c.goals) ? c.goals : {};
  const notifications = isRecord(goals.notifications) ? goals.notifications : {};
  return {
    maxTurns:
      typeof goals.maxTurns === 'number' && Number.isFinite(goals.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(goals.maxTurns)))
        : DEFAULT_GOALS_CONFIG.maxTurns,
    judgeModelRef: typeof goals.judgeModelRef === 'string' ? goals.judgeModelRef : '',
    checklistMode: goals.checklistMode !== false,
    checklistDecomposePolicy:
      goals.checklistDecomposePolicy === 'supplement_existing'
        ? 'supplement_existing'
        : DEFAULT_GOALS_CONFIG.checklistDecomposePolicy,
    maxConsecutiveParseFailures:
      typeof goals.maxConsecutiveParseFailures === 'number' &&
      Number.isFinite(goals.maxConsecutiveParseFailures)
        ? Math.max(1, Math.min(20, Math.floor(goals.maxConsecutiveParseFailures)))
        : DEFAULT_GOALS_CONFIG.maxConsecutiveParseFailures,
    judgeTimeoutSec:
      typeof goals.judgeTimeoutMs === 'number' && Number.isFinite(goals.judgeTimeoutMs)
        ? Math.max(5, Math.min(120, Math.round(goals.judgeTimeoutMs / 1000)))
        : DEFAULT_GOALS_CONFIG.judgeTimeoutSec,
    checklistHistoryChars:
      typeof goals.checklistHistoryChars === 'number' && Number.isFinite(goals.checklistHistoryChars)
        ? Math.max(0, Math.min(100_000, Math.floor(goals.checklistHistoryChars)))
        : DEFAULT_GOALS_CONFIG.checklistHistoryChars,
    notifications: {
      enabled: notifications.enabled === true,
      includeLinkedSessions: notifications.includeLinkedSessions !== false,
      channels: Array.isArray(notifications.channels)
        ? notifications.channels.filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
        : DEFAULT_GOALS_CONFIG.notifications.channels,
      events: Array.isArray(notifications.events)
        ? notifications.events.filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
        : DEFAULT_GOALS_CONFIG.notifications.events,
      targets: Array.isArray(notifications.targets)
        ? notifications.targets
            .filter(isRecord)
            .map((target) => ({
              channel: typeof target.channel === 'string' ? target.channel : '',
              chatId: typeof target.chatId === 'string' ? target.chatId : '',
              accountId: typeof target.accountId === 'string' ? target.accountId : undefined,
              threadId:
                typeof target.threadId === 'string' || typeof target.threadId === 'number'
                  ? target.threadId
                  : undefined,
              silent: target.silent === true,
              events: Array.isArray(target.events)
                ? target.events.filter((it): it is string => typeof it === 'string' && it.trim().length > 0)
                : undefined,
            }))
            .filter((target) => target.channel.trim() && target.chatId.trim())
        : [],
    },
  };
}

export async function patchGoalsConfig(state: GoalsConfigState): Promise<void> {
  const notificationTargets = state.notifications.targets
    .map((target) => ({
      ...target,
      chatId: target.chatId.trim(),
      channel: target.channel.trim(),
      accountId: target.accountId?.trim() || undefined,
    }))
    .filter((target) => target.channel && target.chatId && target.chatId !== '__custom__');
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({
      goals: {
        maxTurns: state.maxTurns,
        ...(state.judgeModelRef.trim() ? { judgeModelRef: state.judgeModelRef.trim() } : { judgeModelRef: null }),
        checklistMode: state.checklistMode,
        checklistDecomposePolicy: state.checklistDecomposePolicy,
        maxConsecutiveParseFailures: state.maxConsecutiveParseFailures,
        judgeTimeoutMs: state.judgeTimeoutSec * 1000,
        checklistHistoryChars: state.checklistHistoryChars,
        notifications: {
          enabled: state.notifications.enabled,
          includeLinkedSessions: state.notifications.includeLinkedSessions,
          channels: state.notifications.channels,
          events: state.notifications.events,
          targets: notificationTargets,
        },
      },
    }),
  });
  void revalidateGatewayConfig();
}
