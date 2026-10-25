export function automationChatCreateHref(prompt: string, projectId?: string): string {
  const params = new URLSearchParams({ draft: prompt.trim(), setup: 'automation' });
  const normalizedProjectId = projectId?.trim();
  if (normalizedProjectId) params.set('projectId', normalizedProjectId);
  else params.set('projectScope', 'none');
  return `/chat/new?${params.toString()}`;
}

export function automationChatEditHref(automation: { id: string; name: string; projectId?: string }, language: 'zh' | 'en'): string {
  const prompt = language === 'zh'
    ? `我想调整定时任务“${automation.name}”（ID：${automation.id}）。请先读取这个任务的当前设置，问我想改什么，确认后更新原任务。`
    : `Help me adjust the scheduled task “${automation.name}” (ID: ${automation.id}). Read its current settings first, ask what I want to change, then update the existing task after confirmation.`;
  return automationChatCreateHref(prompt, automation.projectId);
}
