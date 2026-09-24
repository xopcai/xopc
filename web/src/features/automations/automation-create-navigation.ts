export function automationChatCreateHref(prompt: string, projectId?: string): string {
  const params = new URLSearchParams({ draft: prompt.trim() });
  const normalizedProjectId = projectId?.trim();
  if (normalizedProjectId) params.set('projectId', normalizedProjectId);
  else params.set('projectScope', 'none');
  return `/chat/new?${params.toString()}`;
}
