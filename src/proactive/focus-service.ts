import type { Automation, AutomationRun } from '../automations/index.js';
import { GoalService } from '../goals/index.js';
import { createLogger } from '../utils/logger.js';
import {
  addWorkUnderstandingThreadFeedback,
  getWorkUnderstandingThread,
  listWorkUnderstandingThreads,
} from '../work-discovery/thread-repository.js';

import type { FocusView, FocusWatch, FocusWatchKind } from './types.js';
import {
  createFocusWatch,
  getFocusWatchByThreadAndKind,
  listFocusWatches,
  restartFocusWatchTrial,
  recordFocusWatchFeedback,
  setFocusWatchStatus,
} from './watch-repository.js';

const TRIAL_DURATION_MS = 7 * 86_400_000;
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const log = createLogger('FocusService');

interface AutomationPort {
  create(input: {
    name: string;
    description: string;
    projectId?: string;
    trigger: { kind: 'schedule'; schedule: { kind: 'interval'; everyMs: number } };
    action: { kind: 'agent'; instruction: string; timeoutSeconds: number };
    safety: { mode: 'suggest_only' };
    afterRun: { kind: 'none' };
    reliability: { timeoutSeconds: number; disableAfterConsecutiveFailures: number };
  }): Promise<Automation>;
  pause(id: string): Promise<Automation | null>;
  resume(id: string): Promise<Automation | null>;
  update(id: string, patch: { action: { kind: 'agent'; instruction: string; timeoutSeconds: number } }): Promise<Automation | null>;
  runNow(id: string): Promise<AutomationRun>;
}

function instructionForFocus(title: string, summary: string, kind: FocusWatchKind, eventContext?: string): string {
  const intent = kind === 'progress'
    ? 'Look for meaningful progress, blockers, and the most useful next step.'
    : kind === 'staleness'
      ? 'Check whether this focus has stalled and identify the smallest credible unblock.'
      : kind === 'deadline'
        ? 'Check upcoming deadlines or meetings and prepare only the material that is needed next.'
      : 'Search for external changes published since the previous daily check. Use primary sources when possible, include the publication date and canonical URL, reject generic background news, and explain the concrete impact on this focus.';
  return [
    'Maintain this user-confirmed focus in suggest-only mode.',
    `Focus: ${title}`,
    `Context: ${summary}`,
    ...(eventContext ? [`Upcoming event selected by the user: ${eventContext}`] : []),
    intent,
    'Inspect only evidence that changed since the previous daily check; use timestamps, history, status, or source revisions to establish the delta.',
    'Use evidence available to the agent. Do not modify files, send messages, publish content, or claim progress without evidence.',
    'Return JSON only, with no markdown.',
    'If nothing materially changed: {"meaningful":false}.',
    'Otherwise return {"meaningful":true,"title":"short title","summary":"what changed","whyItMatters":"concrete impact","nextAction":"one next action","evidence":[{"label":"specific observed evidence","source":"file, event, or canonical URL","publishedAt":"ISO date when this is external news"}]}.',
    'A meaningful result requires at least one specific evidence item. Never invent evidence. Keep the entire JSON response under 2,000 characters.',
  ].join('\n');
}

export class FocusService {
  private readonly goals = new GoalService();

  constructor(private readonly automations: AutomationPort) {}

  list(options: { includeUnreviewed?: boolean } = {}): FocusView[] {
    const threads = listWorkUnderstandingThreads({ limit: 200 })
      .filter((thread) => options.includeUnreviewed || thread.userStatus === 'confirmed' || thread.userStatus === 'corrected');
    const watches = listFocusWatches();
    const goals = this.goals.list({ status: ['active', 'blocked', 'needs_input', 'paused'], limit: 200 });
    return threads.map((thread) => {
      const goal = goals.find((candidate) => candidate.projectId && thread.projectIds.includes(candidate.projectId));
      return {
        id: thread.id,
        title: thread.title,
        summary: thread.summary,
        status: thread.status,
        horizon: thread.horizon,
        confidence: thread.confidence,
        focusScore: thread.focusScore,
        userStatus: thread.userStatus,
        projectIds: thread.projectIds,
        ...(goal ? { goalId: goal.id, nextAction: goal.nextAction, blockedReason: goal.blockedReason } : {}),
        watches: watches.filter((watch) => watch.threadId === thread.id),
        lastObservedAt: thread.lastObservedAt,
      };
    });
  }

  confirm(id: string): FocusView | null {
    const thread = addWorkUnderstandingThreadFeedback({ threadId: id, decision: 'confirmed' });
    return thread ? this.list({ includeUnreviewed: true }).find((focus) => focus.id === thread.id) ?? null : null;
  }

  async activateTrial(input: {
    threadId: string;
    kind?: FocusWatchKind;
    eventContext?: string;
  }): Promise<{ focus: FocusView; watch: FocusWatch }> {
    const kind = input.kind ?? 'progress';
    let thread = getWorkUnderstandingThread(input.threadId);
    if (!thread || thread.userStatus === 'rejected') throw new Error('Focus not found');
    if (thread.userStatus === 'unreviewed') {
      thread = addWorkUnderstandingThreadFeedback({ threadId: thread.id, decision: 'confirmed' });
    }
    if (!thread) throw new Error('Focus not found');

    const existing = getFocusWatchByThreadAndKind(thread.id, kind);
    if (existing) {
      if (input.eventContext) {
        await this.automations.update(existing.automationId, {
          action: {
            kind: 'agent',
            instruction: instructionForFocus(thread.title, thread.summary, kind, input.eventContext),
            timeoutSeconds: 300,
          },
        });
      }
      if (existing.status === 'paused') {
        await this.automations.resume(existing.automationId);
        restartFocusWatchTrial(existing.id, Date.now() + TRIAL_DURATION_MS);
      }
      if (input.eventContext) {
        void this.automations.runNow(existing.automationId).catch((err) => {
          log.warn({ err, automationId: existing.automationId, watchId: existing.id }, 'Focus event preparation run failed');
        });
      }
      const focus = this.list({ includeUnreviewed: true }).find((item) => item.id === thread!.id)!;
      return { focus, watch: getFocusWatchByThreadAndKind(thread.id, kind)! };
    }

    const automation = await this.automations.create({
      name: `Keep moving: ${thread.title}`.slice(0, 200),
      description: `Seven-day ${kind} watch for a user-confirmed focus.`,
      ...(thread.projectIds[0] ? { projectId: thread.projectIds[0] } : {}),
      trigger: { kind: 'schedule', schedule: { kind: 'interval', everyMs: DAILY_INTERVAL_MS } },
      action: {
        kind: 'agent',
        instruction: instructionForFocus(thread.title, thread.summary, kind, input.eventContext),
        timeoutSeconds: 300,
      },
      safety: { mode: 'suggest_only' },
      afterRun: { kind: 'none' },
      reliability: { timeoutSeconds: 300, disableAfterConsecutiveFailures: 3 },
    });
    const watch = createFocusWatch({
      threadId: thread.id,
      automationId: automation.id,
      kind,
      config: { cadence: 'daily', notifyOnlyWhenMeaningful: true },
      trialEndsAt: Date.now() + TRIAL_DURATION_MS,
    });
    void this.automations.runNow(automation.id).catch((err) => {
      log.warn({ err, automationId: automation.id, watchId: watch.id }, 'Initial focus watch run failed');
    });
    const focus = this.list({ includeUnreviewed: true }).find((item) => item.id === thread!.id)!;
    return { focus, watch };
  }

  async pauseWatch(id: string): Promise<FocusWatch | null> {
    const watch = listFocusWatches().find((item) => item.id === id);
    if (!watch) return null;
    await this.automations.pause(watch.automationId);
    return setFocusWatchStatus(id, 'paused');
  }

  async reconcileExpiredTrials(nowMs = Date.now()): Promise<number> {
    const expired = listFocusWatches({ status: 'active' })
      .filter((watch) => watch.trialEndsAt != null && watch.trialEndsAt <= nowMs);
    for (const watch of expired) {
      await this.automations.pause(watch.automationId);
      setFocusWatchStatus(watch.id, 'paused', nowMs);
    }
    return expired.length;
  }

  async recordInsightFeedback(watchId: string, useful: boolean): Promise<FocusWatch | null> {
    const result = recordFocusWatchFeedback(watchId, useful);
    if (!result) return null;
    if (!useful && result.consecutiveDismissed >= 3) {
      return this.pauseWatch(watchId);
    }
    return result.watch;
  }
}
