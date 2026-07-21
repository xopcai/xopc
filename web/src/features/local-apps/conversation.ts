import type { ProjectSession } from '@/features/projects/api';

export const LOCAL_APP_CODER_SKILL = 'build-xopc-local-app';

function sessionAgentId(session: ProjectSession): string {
  return (session.routing?.agentId ?? session.agentId ?? '').trim().toLowerCase();
}

export function selectLocalAppCoderSession(sessions: ProjectSession[]): ProjectSession | null {
  return sessions.find((session) => sessionAgentId(session) === 'coder') ?? null;
}

export function localAppConversationUrl(sessionKey: string, draft?: string): string {
  const params = new URLSearchParams({ skill: LOCAL_APP_CODER_SKILL });
  const trimmedDraft = draft?.trim();
  if (trimmedDraft) params.set('draft', trimmedDraft);
  return `/chat/${encodeURIComponent(sessionKey)}?${params.toString()}`;
}
