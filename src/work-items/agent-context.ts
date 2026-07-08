import type { AgentSourceContext } from '../agent/source-context/types.js';

import type { WorkItem } from './types.js';

function contextLine(label: string, value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? `${label}: ${text}` : null;
}

export function buildWorkItemAgentContext(item: WorkItem): AgentSourceContext {
  const links = item.links?.length
    ? item.links
      .slice(0, 12)
      .map((link) => `- ${link.kind}: ${link.title || link.targetId}${link.statusSnapshot ? ` (${link.statusSnapshot})` : ''}`)
      .join('\n')
    : '';
  const text = [
    'You are working inside a project work item. Treat this as the active task context, not as a new user message.',
    '',
    contextLine('Work item id', item.id),
    contextLine('Project id', item.projectId),
    contextLine('Title', item.title),
    contextLine('Status', item.status),
    contextLine('Priority', item.priority),
    contextLine('Owner agent', item.ownerAgentId),
    contextLine('Description', item.description),
    contextLine('Next action', item.nextAction),
    contextLine('Blocked reason', item.blockedReason),
    item.dueAt ? contextLine('Due at', new Date(item.dueAt).toISOString()) : null,
    links ? `Linked executions:\n${links}` : null,
    '',
    'When you answer, keep the work item moving. If the discussion changes scope, call out the suggested work item update explicitly.',
  ].filter(Boolean).join('\n');

  return {
    kind: 'work_item',
    sourceId: item.id,
    version: String(item.updatedAt),
    title: item.title,
    text,
  };
}
