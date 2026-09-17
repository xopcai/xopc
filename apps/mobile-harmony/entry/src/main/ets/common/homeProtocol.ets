import { XopcHomeAction, XopcHomeCommand, XopcHomeDecision, XopcHomeResponse, XopcMobileRoute } from '../model/home';
import { XopcTask, XopcTaskResult } from '../model/workspace';

export function mobileRoute(href: string): XopcMobileRoute | undefined {
  // Only known internal routes are allowed; never load server-provided external URLs.
  if (!href.startsWith('/') || href.startsWith('//')) return undefined;
  const parts = href.split('?');
  const segments = parts[0].split('/').filter((part: string): boolean => part.length > 0);
  if (segments.length > 2) return undefined;
  const page = segments[0] ?? '';
  if (!['chat', 'tasks', 'projects', 'notes', 'files', 'automations', 'workflows', 'inbox', 'connectors'].includes(page)) return undefined;
  try {
    let itemId = segments.length === 2 ? decodeURIComponent(segments[1]) : '';
    let target = page === 'connectors' ? 'settings' : page;
    for (const pair of (parts[1] ?? '').split('&')) {
      const entry = pair.split('=');
      const key = entry[0]; const text = decodeURIComponent(entry[1] ?? '');
      if (page === 'notes' && key === 'status' && text === 'inbox') target = 'inbox';
      if ((page === 'notes' || page === 'inbox') && key === 'item') itemId = text;
      if (page === 'workflows' && key === 'runId') itemId = text;
      if (page === 'automations' && key === 'automation') itemId = text;
      if (page === 'automations' && key === 'run') { target = 'automation-run'; itemId = text; }
    }
    return { page: target, itemId };
  } catch (_error) { return undefined; }
}

export function parseHome(raw: string): XopcHomeResponse {
  const result = JSON.parse(raw) as XopcHomeResponse;
  if (!result || !Array.isArray(result.needsUser) || !Array.isArray(result.background)) throw new Error('INVALID_HOME');
  for (const item of result.needsUser.concat(result.background)) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.summary !== 'string') throw new Error('INVALID_HOME_ITEM');
    if (!Array.isArray(item.secondaryActions)) item.secondaryActions = [];
    const actions = item.primaryAction ? [item.primaryAction].concat(item.secondaryActions) : item.secondaryActions;
    const approval = actions.find((action: XopcHomeAction): boolean => action?.type === 'connector_decision');
    if (approval?.approvalId && Array.isArray(result.decisions)) {
      const decision = result.decisions.find((entry: XopcHomeDecision): boolean => entry?.response?.approvalId === approval.approvalId);
      if (typeof decision?.detail === 'string') item.reviewDetail = decision.detail;
    }
  }
  return result;
}

export function homeCommand(action: XopcHomeAction): XopcHomeCommand {
  if (action.type === 'connector_decision' && action.approvalId && ['approve', 'deny'].includes(action.decision ?? '')) {
    return { kind: 'connector_approval', approvalId: action.approvalId, decision: action.decision };
  }
  if (['retry_run', 'acknowledge_run'].includes(action.type) && action.runId &&
    ['automation_run', 'workflow_run'].includes(action.subjectKind ?? '')) {
    return { kind: action.subjectKind ?? '', runId: action.runId };
  }
  throw new Error('INVALID_HOME_ACTION');
}

export function recentClosed(items: XopcTaskResult[]): XopcTask[] {
  return items.map((item: XopcTaskResult): XopcTask => item.task)
    .filter((task: XopcTask): boolean => task.phase === 'closed')
    .sort((left: XopcTask, right: XopcTask): number => (right.closedAt ?? right.updatedAt ?? 0) - (left.closedAt ?? left.updatedAt ?? 0)).slice(0, 5);
}
