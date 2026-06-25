import type { Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import type { SessionMetadata } from '../session/index.js';

import { GoalService } from './goal-service.js';
import type { GoalWithDetails } from './types.js';
import type { GoalQueueItemSnapshot } from './goal-queue-types.js';

const log = createLogger('GoalNotifications');

export type GoalNotificationEvent =
  | 'done'
  | 'blocked'
  | 'needs_input'
  | 'queue_failed'
  | 'queue_retry'
  | 'queue_succeeded'
  | 'queue_skipped';

export interface GoalNotificationTarget {
  channel: string;
  chatId: string;
  accountId?: string;
  threadId?: string | number;
  silent?: boolean;
}

export interface GoalNotificationSendInput extends GoalNotificationTarget {
  text: string;
}

export interface GoalNotificationServiceOptions {
  getConfig: () => Config;
  getSessionMetadata?: (sessionKey: string) => Promise<SessionMetadata | null>;
  send: (input: GoalNotificationSendInput) => Promise<void>;
}

function eventForQueueStatus(status: GoalQueueItemSnapshot['status']): GoalNotificationEvent | null {
  if (status === 'failed') return 'queue_failed';
  if (status === 'retry_waiting') return 'queue_retry';
  if (status === 'succeeded') return 'queue_succeeded';
  if (status === 'skipped') return 'queue_skipped';
  return null;
}

function eventForGoalStatus(status: GoalWithDetails['status']): GoalNotificationEvent | null {
  if (status === 'done' || status === 'blocked' || status === 'needs_input') return status;
  return null;
}

function targetKey(target: GoalNotificationTarget): string {
  return [
    target.channel,
    target.chatId,
    target.accountId ?? '',
    target.threadId ?? '',
  ].join('\u0000');
}

function formatGoalNotification(event: GoalNotificationEvent, goal: GoalWithDetails, opts?: {
  queueItem?: GoalQueueItemSnapshot;
}): string {
  const labels: Record<GoalNotificationEvent, string> = {
    done: 'Goal completed',
    blocked: 'Goal blocked',
    needs_input: 'Goal needs input',
    queue_failed: 'Goal run failed',
    queue_retry: 'Goal run retry scheduled',
    queue_succeeded: 'Goal run finished',
    queue_skipped: 'Goal run skipped',
  };
  const lines = [`${labels[event]}: ${goal.title}`];
  if (goal.blockedReason) lines.push(`Reason: ${goal.blockedReason}`);
  if (goal.nextAction) lines.push(`Next: ${goal.nextAction}`);
  if (goal.latestRun?.reason && goal.latestRun.reason !== goal.blockedReason) {
    lines.push(`Run: ${goal.latestRun.reason}`);
  }
  if (opts?.queueItem?.lastError) lines.push(`Queue: ${opts.queueItem.lastError}`);
  const progress = goal.checklist.length
    ? goal.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length
    : 0;
  if (goal.checklist.length) lines.push(`Checklist: ${progress}/${goal.checklist.length}`);
  lines.push(`Turns: ${goal.turnsUsed}/${goal.maxTurns}`);
  return lines.join('\n');
}

export class GoalNotificationService {
  private readonly goals = new GoalService();
  private readonly sentKeys = new Set<string>();

  constructor(private readonly opts: GoalNotificationServiceOptions) {}

  handleGatewayEvent(type: string, payload: unknown): void {
    if (type === 'goal.queue.updated') {
      void this.handleQueueUpdated(payload).catch((err) => {
        log.warn({ err }, 'Goal queue notification failed');
      });
      return;
    }
    if (type === 'goal.status.updated') {
      void this.handleStatusUpdated(payload).catch((err) => {
        log.warn({ err }, 'Goal status notification failed');
      });
    }
  }

  private async handleQueueUpdated(payload: unknown): Promise<void> {
    const item = this.parseQueueItem(payload);
    if (!item) return;
    const event = eventForQueueStatus(item.status);
    if (!event) return;
    const goal = this.goals.get(item.goalId);
    if (!goal) return;
    await this.notify(event, goal, { queueItem: item, eventKey: `${item.id}:${item.status}:${item.attempts}` });
  }

  private async handleStatusUpdated(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object') return;
    const rec = payload as { goal?: unknown; status?: unknown; goalId?: unknown; previousStatus?: unknown };
    const goal =
      this.isGoal(rec.goal)
        ? rec.goal
        : typeof rec.goalId === 'string'
          ? this.goals.get(rec.goalId)
          : null;
    if (!goal) return;
    const status = typeof rec.status === 'string' ? rec.status : goal.status;
    const event = eventForGoalStatus(status as GoalWithDetails['status']);
    if (!event) return;
    if (rec.previousStatus === status) return;
    await this.notify(event, goal, { eventKey: `${goal.id}:${event}:${goal.updatedAt}` });
  }

  private async notify(
    event: GoalNotificationEvent,
    goal: GoalWithDetails,
    opts?: { queueItem?: GoalQueueItemSnapshot; eventKey?: string },
  ): Promise<void> {
    const policy = this.opts.getConfig().goals?.notifications;
    if (!policy?.enabled) return;
    if (!policy.events.includes(event)) return;

    const targets = await this.resolveTargets(event, goal);
    if (targets.length === 0) return;

    const text = formatGoalNotification(event, goal, { queueItem: opts?.queueItem });
    for (const target of targets) {
      const dedupeKey = `${opts?.eventKey ?? `${goal.id}:${event}`}:${targetKey(target)}`;
      if (this.sentKeys.has(dedupeKey)) continue;
      this.sentKeys.add(dedupeKey);
      await this.opts.send({ ...target, text }).catch((err) => {
        this.sentKeys.delete(dedupeKey);
        throw err;
      });
    }
  }

  private async resolveTargets(event: GoalNotificationEvent, goal: GoalWithDetails): Promise<GoalNotificationTarget[]> {
    const policy = this.opts.getConfig().goals?.notifications;
    if (!policy?.enabled) return [];
    const byKey = new Map<string, GoalNotificationTarget>();

    if (policy.includeLinkedSessions !== false && goal.activeSessionKey && this.opts.getSessionMetadata) {
      const metadata = await this.opts.getSessionMetadata(goal.activeSessionKey).catch((err) => {
        log.warn({ err, sessionKey: goal.activeSessionKey, goalId: goal.id }, 'Failed to load linked session metadata for goal notification');
        return null;
      });
      const routing = metadata?.routing;
      const eligible = routing && policy.channels.includes(routing.source);
      if (eligible) {
        const target: GoalNotificationTarget = {
          channel: routing.source,
          chatId: routing.peerId,
          accountId: routing.accountId,
          ...(routing.threadId ? { threadId: routing.threadId } : {}),
        };
        byKey.set(targetKey(target), target);
      }
    }

    for (const target of policy.targets ?? []) {
      const events = target.events;
      if (events && !events.includes(event)) continue;
      const normalized: GoalNotificationTarget = {
        channel: target.channel,
        chatId: target.chatId,
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.threadId != null ? { threadId: target.threadId } : {}),
        ...(target.silent != null ? { silent: target.silent } : {}),
      };
      byKey.set(targetKey(normalized), normalized);
    }

    return [...byKey.values()];
  }

  private parseQueueItem(payload: unknown): GoalQueueItemSnapshot | null {
    if (!payload || typeof payload !== 'object') return null;
    const item = (payload as { item?: unknown }).item;
    if (!item || typeof item !== 'object') return null;
    const rec = item as Partial<GoalQueueItemSnapshot>;
    if (typeof rec.id !== 'string' || typeof rec.goalId !== 'string' || typeof rec.status !== 'string') return null;
    return rec as GoalQueueItemSnapshot;
  }

  private isGoal(value: unknown): value is GoalWithDetails {
    if (!value || typeof value !== 'object') return false;
    const rec = value as Partial<GoalWithDetails>;
    return typeof rec.id === 'string' && typeof rec.title === 'string' && Array.isArray(rec.checklist);
  }
}
