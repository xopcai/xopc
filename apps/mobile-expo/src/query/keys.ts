export const queryKeys = {
  sessions: (search?: string) => ['sessions', search?.trim() ?? ''] as const,
  sessionsRecent: ['sessions', 'recent'] as const,
  sessionsAll: ['sessions'] as const,
  session: (key: string) => ['session', key] as const,
  sessionContext: (key: string) => ['session', key, 'context'] as const,
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
  automations: ['automations'] as const,
  automation: (id: string) => ['automations', id] as const,
  automationMetrics: ['automations', 'metrics'] as const,
  automationRuns: (limit: number, automationId?: string) => ['automations', 'runs', limit, automationId ?? 'all'] as const,
  automationRun: (id: string) => ['automations', 'runs', id] as const,
  automationRunEvents: (id: string) => ['automations', 'runs', id, 'events'] as const,
  shares: ['shares'] as const,
  fileSpaces: ['files', 'spaces'] as const,
  recentFiles: ['files', 'recent'] as const,
  fileSpaceContext: (kind: string, id: string) => ['files', 'context', kind, id] as const,
  fileChildren: (spaceId: string, path: string) => ['files', 'children', spaceId, path] as const,
  fileSearch: (query: string, spaceId?: string) => ['files', 'search', spaceId ?? 'all', query.trim()] as const,
  workspaceDir: (scope: string, dir: string) => ['workspace', 'dir', scope, dir] as const,
  notes: (query?: string) => ['notes', query?.trim() ?? ''] as const,
  notesAll: ['notes'] as const,
  homeRecentNotes: ['notes', 'home-recent'] as const,
  homeInboxCount: ['notes', 'home-inbox-count'] as const,
  workspaceSearch: (query: string) => ['workspace-search', query.trim()] as const,
  note: (id: string) => ['note', id] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  projectOperatingView: (id: string) => ['project', id, 'operating-view'] as const,
  projectSessions: (id: string) => ['project', id, 'sessions'] as const,
  projectNotes: (id: string) => ['project', id, 'notes'] as const,
  projectActivity: (id: string) => ['project', id, 'activity'] as const,
  projectAutomations: (id: string) => ['project', id, 'automations'] as const,
  projectSkills: (id: string) => ['project', id, 'skills'] as const,
  home: ['home'] as const,
  task: (id: string) => ['task', id] as const,
  taskConversation: (id: string) => ['task', id, 'conversation'] as const,
  tasks: ['tasks'] as const,
  workflowRuns: ['workflows', 'runs'] as const,
  workflowRun: (id: string, agentId?: string) => ['workflows', 'runs', id, agentId ?? ''] as const,
  judgments: ['inbox', 'judgments'] as const,
};
