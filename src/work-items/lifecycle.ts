import type {
  WorkItem,
  WorkItemCommand,
  WorkItemPhase,
  WorkItemWait,
} from '@xopcai/gateway-contract';

export type WorkItemCommandActor =
  | { kind: 'user'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'system'; id: string };

export interface WorkItemTransitionContext {
  actor: WorkItemCommandActor;
  now: number;
  createId: () => string;
}

export interface WorkItemTransition {
  item: WorkItem;
  eventType: string;
  eventPayload: Record<string, unknown>;
}

export class WorkItemTransitionError extends Error {
  constructor(
    readonly code: 'version_conflict' | 'invalid_transition' | 'forbidden' | 'invalid_command',
    message: string,
  ) {
    super(message);
    this.name = 'WorkItemTransitionError';
  }
}

function requirePhase(item: WorkItem, command: WorkItemCommand, allowed: WorkItemPhase[]): void {
  if (!allowed.includes(item.phase)) {
    throw new WorkItemTransitionError(
      'invalid_transition',
      `Cannot ${command.type} a work item in phase ${item.phase}`,
    );
  }
}

function closeItem(
  item: WorkItem,
  now: number,
  resolution: NonNullable<WorkItem['resolution']>,
  reason?: string,
): WorkItem {
  return {
    ...item,
    phase: 'closed',
    resolution,
    resolutionReason: reason,
    closedAt: now,
    nextAction: undefined,
    waits: item.waits.map((wait) => wait.resolvedAt
      ? wait
      : { ...wait, resolvedAt: now, resolutionNote: 'Work item closed.' }),
  };
}

function changed(
  item: WorkItem,
  context: WorkItemTransitionContext,
  eventType: string,
  eventPayload: Record<string, unknown>,
): WorkItemTransition {
  return {
    item: { ...item, version: item.version + 1, updatedAt: context.now },
    eventType,
    eventPayload,
  };
}

export function availableWorkItemCommands(item: WorkItem, actor: WorkItemCommandActor): WorkItemCommand['type'][] {
  const commands: WorkItemCommand['type'][] = [];
  if (item.phase === 'backlog') commands.push('commit', 'close');
  if (item.phase === 'ready') commands.push('defer', 'start', 'wait', 'close');
  if (item.phase === 'executing') {
    commands.push('stop', 'request_review', 'wait', 'close');
    if (item.completionPolicy !== 'user_accepted') commands.push('complete');
  }
  if (item.phase === 'verifying') {
    commands.push('request_changes', 'wait', 'close');
    if (item.completionPolicy !== 'user_accepted') commands.push('complete');
    if (item.completionPolicy === 'user_accepted' && actor.kind === 'user') commands.push('accept');
  }
  if (item.phase === 'closed') commands.push('reopen');
  if (item.waits.some((wait) => !wait.resolvedAt)) commands.push('resume');
  return [...new Set(commands)];
}

export function transitionWorkItem(
  current: WorkItem,
  command: WorkItemCommand,
  context: WorkItemTransitionContext,
): WorkItemTransition {
  if (current.version !== command.expectedVersion) {
    throw new WorkItemTransitionError(
      'version_conflict',
      `Expected work item version ${command.expectedVersion}, found ${current.version}`,
    );
  }

  switch (command.type) {
    case 'commit':
      requirePhase(current, command, ['backlog']);
      return changed({ ...current, phase: 'ready' }, context, 'work_item.committed', {});
    case 'defer':
      requirePhase(current, command, ['ready']);
      return changed({ ...current, phase: 'backlog' }, context, 'work_item.deferred', { reason: command.reason });
    case 'start':
      requirePhase(current, command, ['ready']);
      return changed({
        ...current,
        phase: 'executing',
        startedAt: current.startedAt ?? context.now,
        nextAction: command.nextAction ?? current.nextAction,
      }, context, 'work_item.started', {});
    case 'stop':
      requirePhase(current, command, ['executing']);
      return changed({ ...current, phase: 'ready' }, context, 'work_item.stopped', { reason: command.reason });
    case 'request_review': {
      requirePhase(current, command, ['executing']);
      const waits = current.completionPolicy === 'user_accepted'
        ? [...current.waits, {
            id: context.createId(),
            workItemId: current.id,
            kind: 'user_approval' as const,
            reason: command.summary,
            createdAt: context.now,
          }]
        : current.waits;
      return changed({
        ...current,
        phase: 'verifying',
        reviewRequestedAt: context.now,
        nextAction: current.completionPolicy === 'user_accepted'
          ? { text: command.summary, actor: 'user' }
          : current.nextAction,
        waits,
      }, context, 'work_item.review_requested', { summary: command.summary });
    }
    case 'request_changes':
      requirePhase(current, command, ['verifying']);
      return changed({
        ...current,
        phase: 'executing',
        nextAction: command.nextAction,
        waits: current.waits.map((wait) => wait.resolvedAt || wait.kind !== 'user_approval'
          ? wait
          : { ...wait, resolvedAt: context.now, resolutionNote: command.reason }),
      }, context, 'work_item.changes_requested', { reason: command.reason });
    case 'complete':
      requirePhase(current, command, ['executing', 'verifying']);
      if (current.completionPolicy === 'user_accepted') {
        throw new WorkItemTransitionError('forbidden', 'This work item requires user acceptance');
      }
      return changed(closeItem(current, context.now, 'completed', command.summary), context, 'work_item.completed', { summary: command.summary });
    case 'accept':
      requirePhase(current, command, ['verifying']);
      if (current.completionPolicy !== 'user_accepted') {
        throw new WorkItemTransitionError('invalid_command', 'This work item does not require user acceptance');
      }
      if (context.actor.kind !== 'user') {
        throw new WorkItemTransitionError('forbidden', 'Only a user may accept this work item');
      }
      return changed(closeItem(current, context.now, 'completed', command.note), context, 'work_item.completed', { accepted: true, note: command.note });
    case 'close':
      requirePhase(current, command, ['backlog', 'ready', 'executing', 'verifying']);
      return changed(closeItem(current, context.now, command.resolution, command.reason), context, 'work_item.closed', { resolution: command.resolution, reason: command.reason });
    case 'reopen':
      requirePhase(current, command, ['closed']);
      return changed({
        ...current,
        phase: 'ready',
        resolution: undefined,
        resolutionReason: undefined,
        closedAt: undefined,
        nextAction: undefined,
      }, context, 'work_item.reopened', { reason: command.reason });
    case 'wait': {
      requirePhase(current, command, ['ready', 'executing', 'verifying']);
      if (command.wait.kind === 'dependency' && !command.wait.blockingWorkItemId) {
        throw new WorkItemTransitionError('invalid_command', 'A dependency wait requires blockingWorkItemId');
      }
      if (command.wait.kind !== 'dependency' && command.wait.blockingWorkItemId) {
        throw new WorkItemTransitionError('invalid_command', 'Only dependency waits may reference a blocking work item');
      }
      if ((command.wait.kind === 'scheduled' || command.wait.kind === 'retry') && command.wait.resumeAt === undefined) {
        throw new WorkItemTransitionError('invalid_command', `${command.wait.kind} waits require resumeAt`);
      }
      const wait: WorkItemWait = {
        id: context.createId(),
        workItemId: current.id,
        ...command.wait,
        createdAt: context.now,
      };
      return changed({ ...current, waits: [...current.waits, wait] }, context, 'work_item.wait_created', { wait });
    }
    case 'resume': {
      requirePhase(current, command, ['ready', 'executing', 'verifying']);
      const target = current.waits.find((wait) => wait.id === command.waitId && !wait.resolvedAt);
      if (!target) throw new WorkItemTransitionError('invalid_command', `Open wait not found: ${command.waitId}`);
      if ((target.kind === 'user_approval' || target.kind === 'user_input') && context.actor.kind !== 'user') {
        throw new WorkItemTransitionError('forbidden', 'Only a user may resolve this wait');
      }
      return changed({
        ...current,
        waits: current.waits.map((wait) => wait.id === command.waitId
          ? { ...wait, resolvedAt: context.now, resolutionNote: command.note }
          : wait),
      }, context, 'work_item.wait_resolved', { waitId: command.waitId, note: command.note });
    }
  }
}
