export interface XopcNotificationTarget { kind: string; conversationId?: string; taskId?: string; automationId?: string; }
export interface XopcNotificationRoute { gatewayId: string; eventId: string; target: XopcNotificationTarget; }
export function notificationRoute(json: string, gatewayId: string): XopcNotificationRoute | undefined {
  if (json.length > 4096) return undefined;
  try {
    const route = JSON.parse(json) as XopcNotificationRoute;
    if (!route || route.gatewayId !== gatewayId || typeof route.eventId !== 'string' || route.eventId.length > 160 || !route.target) return undefined;
    const target = route.target;
    const id = target.kind === 'chat' || target.kind === 'work_discovery' ? target.conversationId
      : target.kind === 'task' ? target.taskId : target.kind === 'automation_run' ? target.automationId : undefined;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return undefined;
    return route;
  } catch (_error) { return undefined; }
}
