export const queryKeys = {
  sessions: (search?: string) => ['sessions', search?.trim() ?? ''] as const,
  sessionsRecent: ['sessions', 'recent'] as const,
  sessionsAll: ['sessions'] as const,
  session: (key: string) => ['session', key] as const,
  sessionAgentConfig: (key: string) => ['session', key, 'agent-config'] as const,
  sessionHistory: (key: string, profileId?: string | null) => (
    profileId
      ? ['session', key, 'history', 'gateway', profileId] as const
      : ['session', key, 'history'] as const
  ),
  sessionHistoryOlderPreview: (key: string, before: string, profileId?: string | null) => (
    profileId
      ? ['session', key, 'history', 'olderPreview', before, 'gateway', profileId] as const
      : ['session', key, 'history', 'olderPreview', before] as const
  ),
  agents: ['agents'] as const,
  models: (agentId?: string) => ['models', agentId ?? ''] as const,
  cronJobs: ['cron', 'jobs'] as const,
  cronJob: (id: string) => ['cron', 'job', id] as const,
  cronRunsHistory: (limit: number) => ['cron', 'runs', limit] as const,
  shares: ['shares'] as const,
  workspaceDir: (scope: string, dir: string) => ['workspace', 'dir', scope, dir] as const,
  notes: (query?: string) => ['notes', query?.trim() ?? ''] as const,
  notesAll: ['notes'] as const,
  note: (id: string) => ['note', id] as const,
  projects: ['projects'] as const,
  projectOperatingView: (id: string) => ['project', id, 'operating-view'] as const,
  home: ['home'] as const,
  task: (id: string) => ['task', id] as const,
  tasks: ['tasks'] as const,
  judgments: ['inbox', 'judgments'] as const,
};
