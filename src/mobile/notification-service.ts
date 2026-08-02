import { createLogger } from '../utils/logger.js';
import type { AutomationRun } from '../automations/domain/types.js';

import {
  createMobileActivityEvent,
  disableMobileDeviceForPushToken,
  listEnabledMobileDevices,
} from './notification-store.js';
import type {
  MobileActivityEvent,
  MobileNotificationEventType,
} from './notification-types.js';

const log = createLogger('MobileNotifications');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type GoalPayload = {
  goal?: { id?: unknown; title?: unknown; activeSessionKey?: unknown };
  goalId?: unknown;
  status?: unknown;
};

type ExpoPushResult = { status?: string; details?: { error?: string } };

function shouldDeliver(type: MobileNotificationEventType, preferences: {
  needsInput: boolean;
  failed: boolean;
  completed: boolean;
  automationFailed: boolean;
}): boolean {
  if (type === 'goal.needs_input') return preferences.needsInput;
  if (type === 'goal.blocked') return preferences.failed;
  if (type === 'automation.failed') return preferences.automationFailed;
  return preferences.completed;
}

function goalEvent(payload: unknown): Omit<MobileActivityEvent, 'id' | 'createdAt'> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as GoalPayload;
  const goal = data.goal;
  const goalId = typeof goal?.id === 'string' ? goal.id : typeof data.goalId === 'string' ? data.goalId : '';
  const status = typeof data.status === 'string' ? data.status : '';
  if (!goalId || !['needs_input', 'blocked', 'done'].includes(status)) return null;
  const type: MobileNotificationEventType = status === 'needs_input'
    ? 'goal.needs_input'
    : status === 'blocked'
      ? 'goal.blocked'
      : 'goal.completed';
  const sessionKey = typeof goal?.activeSessionKey === 'string' ? goal.activeSessionKey : '';
  const route = sessionKey ? `/chat/${encodeURIComponent(sessionKey)}` : '/';
  return {
    type,
    entity: { kind: 'goal', id: goalId },
    priority: type === 'goal.needs_input' || type === 'goal.blocked' ? 'high' : 'normal',
    title: type === 'goal.needs_input' ? 'Action needed' : type === 'goal.blocked' ? 'Goal blocked' : 'Goal completed',
    body: typeof goal?.title === 'string' ? goal.title.slice(0, 120) : undefined,
    deepLink: route,
    payload: { route, goalId, eventType: type },
  };
}

function automationEvent(payload: unknown): Omit<MobileActivityEvent, 'id' | 'createdAt'> | null {
  if (!payload || typeof payload !== 'object') return null;
  if ((payload as { silent?: unknown }).silent === true) return null;
  const run = (payload as { run?: AutomationRun }).run;
  if (!run || (run.status !== 'failed' && run.status !== 'timeout' && run.status !== 'succeeded')) return null;
  const type: MobileNotificationEventType = run.status === 'succeeded'
    ? 'automation.completed'
    : 'automation.failed';
  return {
    type,
    entity: { kind: 'automation', id: run.automationId },
    priority: type === 'automation.failed' ? 'high' : 'normal',
    title: type === 'automation.failed' ? 'Automation failed' : 'Automation completed',
    body: run.automationName.slice(0, 120),
    deepLink: '/automation',
    payload: { route: '/automation', automationId: run.automationId, runId: run.id, eventType: type },
  };
}

/** Converts gateway domain events into a portable mobile activity and push payload. */
export function mobileNotificationEventFromGatewayEvent(
  type: string,
  payload: unknown,
): Omit<MobileActivityEvent, 'id' | 'createdAt'> | null {
  if (type === 'goal.status.updated') return goalEvent(payload);
  if (type === 'automation.run.completed') return automationEvent(payload);
  return null;
}

async function sendExpoPush(token: string, event: MobileActivityEvent): Promise<void> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      to: token,
      title: event.title,
      body: event.body,
      sound: event.priority === 'high' ? 'default' : undefined,
      priority: event.priority,
      data: { eventId: event.id, ...event.payload },
    }),
  });
  if (!response.ok) throw new Error(`Expo push request failed (${response.status})`);
  const result = await response.json().catch(() => null) as { data?: ExpoPushResult | ExpoPushResult[] } | null;
  const item = Array.isArray(result?.data) ? result?.data[0] : result?.data;
  if (item?.status === 'error') {
    if (item.details?.error === 'DeviceNotRegistered') {
      disableMobileDeviceForPushToken(token);
      return;
    }
    throw new Error(`Expo push rejected: ${item.details?.error ?? 'unknown error'}`);
  }
}

export class MobileNotificationService {
  private readonly sent = new Set<string>();

  handleGatewayEvent(type: string, payload: unknown): void {
    const event = mobileNotificationEventFromGatewayEvent(type, payload);
    if (!event) return;
    const dedupeKey = `${event.type}:${event.entity.kind}:${event.entity.id}:${JSON.stringify(event.payload)}`;
    if (this.sent.has(dedupeKey)) return;
    this.sent.add(dedupeKey);
    void this.deliver(event)
      .catch((err) => {
        log.warn({ err, eventType: event.type, entityId: event.entity.id }, 'Mobile notification delivery failed');
      })
      .finally(() => this.sent.delete(dedupeKey));
  }

  private async deliver(input: Omit<MobileActivityEvent, 'id' | 'createdAt'>): Promise<void> {
    const event = createMobileActivityEvent(input);
    const devices = listEnabledMobileDevices().filter((device) => shouldDeliver(event.type, device.preferences));
    await Promise.all(devices.map(async (device) => {
      try {
        await sendExpoPush(device.pushToken, event);
      } catch (err) {
        log.warn({ err, eventId: event.id, deviceId: device.id }, 'Mobile push request failed');
      }
    }));
  }
}
