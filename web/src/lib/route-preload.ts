export const loadSessionsPage = () => import('@/pages/sessions-page');
export const loadCronPage = () => import('@/pages/cron-page');
export const loadGoalsPage = () => import('@/pages/goals-page');
export const loadGoalDetailPage = () => import('@/pages/goal-detail-page');
export const loadNotesPage = () => import('@/pages/notes-page');
export const loadNoteDetailPage = () => import('@/features/notes/note-detail-page');
export const loadWorkflowsPage = () => import('@/pages/workflows-page');
export const loadSkillsPage = () => import('@/pages/skills-page');
export const loadConnectorsPage = () => import('@/pages/connectors-page');
export const loadLogsPage = () => import('@/pages/logs-page');
export const loadSettingsPage = () => import('@/pages/settings-page');
export const loadAgentsSettingsPage = () => import('@/features/settings/agents');
export const loadChannelsPage = () => import('@/features/settings/channels-settings');
export const loadAppsPage = () => import('@/pages/apps-page');
export const loadExtensionPage = () => import('@/features/extensions/extension-page');
export const loadExtensionSettingsPage = () => import('@/features/extensions/extension-settings-page');
export const loadExtensionDebugPage = () => import('@/features/extensions/extension-debug-page');
export const loadSharePreviewPage = () => import('@/pages/share-preview-page');
export const loadSetupStatusPanel = () => import('@/features/settings/setup-checklist/setup-status-panel');
export const loadAgentDefaultsSettingsPage = () => import('@/features/settings/agents/agent-defaults-tabbed-page');
export const loadAgentBrowserSettingsPage = () => import('@/features/settings/agents/agent-browser-settings-page');
export const loadAppearanceSettingsPanel = () => import('@/features/settings/appearance-settings');
export const loadKeyboardShortcutsSettingsPanel = () => import('@/features/settings/keyboard-shortcuts-settings');
export const loadSystemSettingsPanel = () => import('@/features/settings/system-settings-panel');
export const loadAppManagementSettingsPanel = () => import('@/features/settings/app-management-settings-panel');
export const loadModelsHubPanel = () => import('@/features/settings/models-hub/models-hub-panel');
export const loadGatewaySettingsPanel = () => import('@/features/settings/gateway-settings');
export const loadHeartbeatSettingsPanel = () => import('@/features/settings/heartbeat-settings');
export const loadRemoteAccessHub = () => import('@/features/remote-access/remote-access-hub');
export const loadSharesSettingsPanel = () => import('@/features/shares/shares-settings');
export const loadDreamingSettingsPanel = () => import('@/features/settings/dreaming-settings');
export const loadGoalsSettingsPanel = () => import('@/features/settings/goals-settings');

type RouteLoader = () => Promise<unknown>;

const preloaded = new Set<RouteLoader>();

function preload(loader: RouteLoader) {
  if (preloaded.has(loader)) return;
  preloaded.add(loader);
  void loader().catch(() => {
    preloaded.delete(loader);
  });
}

function pathWithoutSearch(to: string): string {
  const [path] = to.split(/[?#]/, 1);
  return path || '/';
}

function preloadSettingsSection(path: string) {
  preload(loadSettingsPage);

  const section = path.slice('/settings/'.length);
  if (section === 'overview') return preload(loadSetupStatusPanel);
  if (section === 'agent-defaults') return preload(loadAgentDefaultsSettingsPage);
  if (section === 'agent-browser') return preload(loadAgentBrowserSettingsPage);
  if (section === 'appearance') return preload(loadAppearanceSettingsPanel);
  if (section === 'keyboard-shortcuts') return preload(loadKeyboardShortcutsSettingsPanel);
  if (section === 'system') return preload(loadSystemSettingsPanel);
  if (section === 'app-management') return preload(loadAppManagementSettingsPanel);
  if (section === 'credentials') return preload(loadModelsHubPanel);
  if (section === 'gateway') return preload(loadGatewaySettingsPanel);
  if (section === 'heartbeat') return preload(loadHeartbeatSettingsPanel);
  if (section === 'tunnel' || section === 'remote-access') return preload(loadRemoteAccessHub);
  if (section === 'shares') return preload(loadSharesSettingsPanel);
  if (section === 'dreams') return preload(loadDreamingSettingsPanel);
  if (section === 'goals') return preload(loadGoalsSettingsPanel);
}

export function preloadRouteForPath(to: string) {
  if (!to.startsWith('/')) return;

  const path = pathWithoutSearch(to);

  if (path === '/skills') return preload(loadSkillsPage);
  if (path === '/connectors') return preload(loadConnectorsPage);
  if (path === '/cron') return preload(loadCronPage);
  if (path === '/goals') return preload(loadGoalsPage);
  if (path.startsWith('/goals/')) return preload(loadGoalDetailPage);
  if (path === '/notes') return preload(loadNotesPage);
  if (path.startsWith('/notes/')) return preload(loadNoteDetailPage);
  if (path === '/workflows') return preload(loadWorkflowsPage);
  if (path === '/channels' || path.startsWith('/channels/')) return preload(loadChannelsPage);
  if (path === '/agents' || path.startsWith('/agents/')) return preload(loadAgentsSettingsPage);
  if (path === '/apps') return preload(loadAppsPage);
  if (path.startsWith('/apps/')) return preload(loadExtensionPage);
  if (path.startsWith('/share/')) return preload(loadSharePreviewPage);

  if (path === '/settings/sessions') return preload(loadSessionsPage);
  if (path === '/settings/logs') return preload(loadLogsPage);
  if (path === '/settings/apps') return preload(loadAppsPage);
  if (path === '/settings/extensions/debug') return preload(loadExtensionDebugPage);
  if (path.startsWith('/settings/ext/')) return preload(loadExtensionSettingsPage);
  if (path.startsWith('/settings/')) return preloadSettingsSection(path);
}
