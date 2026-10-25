import { automationApi } from './automation-api';

export function automationConfigurationHref(conversationId: string, prompt?: string): string {
  const params = new URLSearchParams({ setup: 'automation' });
  if (prompt?.trim()) params.set('draft', prompt.trim());
  return `/chat/${encodeURIComponent(conversationId)}?${params.toString()}`;
}

export async function openAutomationConfigurationChat(input: { automationId?: string; projectId?: string; prompt?: string; runId?: string }): Promise<string> {
  const { conversationId } = await automationApi.openConfiguration({
    automationId: input.automationId?.trim() || undefined,
    projectId: input.projectId?.trim() || undefined,
    ...(input.runId ? { runId: input.runId } : {}),
  });
  const params = new URLSearchParams(input.automationId ? { automation: input.automationId.trim() } : { new: '1', setupChat: conversationId });
  if (input.projectId?.trim()) params.set('projectId', input.projectId.trim());
  if (input.prompt?.trim()) params.set('chatDraft', input.prompt.trim());
  return `/automations?${params.toString()}`;
}
