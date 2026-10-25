import type { AutomationRun, AutomationRunDeliveryContext } from '../automations/domain/types.js';
import type { NotificationService } from '../notifications/service.js';

/** Commit the inbox handoff before acknowledging the durable result outbox. */
export function deliverAutomationCompletion(
  run: AutomationRun,
  context: AutomationRunDeliveryContext,
  notifications: NotificationService,
  emit: (type: string, payload: unknown) => void,
): void {
  const payload = { run, ...context };
  const notification = notifications.persistGatewayEvent('automation.run.completed', payload);
  emit('automation.run.completed', payload);
  if (notification) emit('notification.created', notification);
  void notifications.drain();
}
