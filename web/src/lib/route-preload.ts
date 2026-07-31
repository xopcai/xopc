export const loadSessionsPage = () => import('@/pages/sessions-page');
export const loadAutomationsPage = () => import('@/pages/automations-page');
export const loadWorkPage = () => import('@/pages/work-page');
export const loadProjectsPage = () => import('@/pages/projects-page');
export const loadProjectDetailPage = () => import('@/pages/project-detail-page');
export const loadWorkItemDetailPage = () => import('@/pages/work-item-detail-page');
export const loadGoalsPage = () => import('@/pages/goals-page');
export const loadGoalDetailPage = () => import('@/pages/goal-detail-page');
export const loadNotesPage = () => import('@/pages/notes-page');
export const loadWorkflowsPage = () => import('@/pages/workflows-page');
export const loadSkillsPage = () => import('@/pages/skills-page');
export const loadUserContextPage = () => import('@/features/user-context/user-context-page');
export const loadConnectorsPage = () => import('@/pages/connectors-page');
export const loadLogsPage = () => import('@/pages/logs-page');
export const loadSettingsPage = () => import('@/pages/settings-page');
export const loadAgentsSettingsPage = () => import('@/features/settings/agents');
export const loadAgentBrowserSettingsPage = () => import('@/features/settings/browser/browser-settings-page');
export const loadChannelsPage = () => import('@/features/settings/channels-settings');
export const loadExtensionsPage = () => import('@/pages/apps-page');
export const loadExtensionPage = () => import('@/features/extensions/extension-page');
export const loadExtensionSettingsPage = () => import('@/features/extensions/extension-settings-page');
export const loadExtensionDebugPage = () => import('@/features/extensions/extension-debug-page');
export const loadSharePreviewPage = () => import('@/pages/share-preview-page');
export const loadLocalAppsPage = () => import('@/pages/local-apps-page');
export const loadLocalAppWorkbenchPage = () => import('@/pages/local-app-workbench-page');
export const loadSetupStatusPanel = () => import('@/features/settings/setup-checklist/setup-status-panel');
export const loadAppearanceSettingsPanel = () => import('@/features/settings/appearance-settings');
export const loadKeyboardShortcutsSettingsPanel = () => import('@/features/settings/keyboard-shortcuts-settings');
export const loadActionBoundarySettingsPanel = () => import('@/features/settings/action-boundary-settings-panel');
export const loadSystemSettingsPanel = () => import('@/features/settings/system-settings-panel');
export const loadDesktopPetSettingsPanel = () => import('@/features/desktop-pet/desktop-pet-settings');
export const loadAppManagementSettingsPanel = () => import('@/features/settings/app-management-settings-panel');
export const loadModelsHubPanel = () => import('@/features/settings/models-hub/models-hub-panel');
export const loadGatewaySettingsPanel = () => import('@/features/settings/gateway-settings');
export const loadHeartbeatSettingsPanel = () => import('@/features/settings/heartbeat-settings');
export const loadRemoteAccessHub = () => import('@/features/remote-access/remote-access-hub');
export const loadSharesSettingsPanel = () => import('@/features/shares/shares-settings');
export const loadDreamingSettingsPanel = () => import('@/features/settings/dreaming-settings');
export const loadGoalsSettingsPanel = () => import('@/features/settings/goals-settings');
export const loadCapabilityPresetsSettingsPanel = () =>
  import('@/features/settings/capability-presets/capability-presets-settings-panel');

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
  if (section === 'appearance') return preload(loadAppearanceSettingsPanel);
  if (section === 'keyboard-shortcuts') return preload(loadKeyboardShortcutsSettingsPanel);
  if (section === 'user-profile') return preload(loadUserContextPage);
  if (section === 'action-boundary') return preload(loadActionBoundarySettingsPanel);
  if (section === 'system') return preload(loadSystemSettingsPanel);
  if (section === 'desktop-pet') return preload(loadDesktopPetSettingsPanel);
  if (section === 'desktop-app') return preload(loadAppManagementSettingsPanel);
  if (section === 'credentials') return preload(loadModelsHubPanel);
  if (section === 'gateway') return preload(loadGatewaySettingsPanel);
  if (section === 'heartbeat') return preload(loadHeartbeatSettingsPanel);
  if (section === 'tunnel' || section === 'remote-access') return preload(loadRemoteAccessHub);
  if (section === 'shares') return preload(loadSharesSettingsPanel);
  if (section === 'dreams') return preload(loadDreamingSettingsPanel);
  if (section === 'goals') return preload(loadGoalsSettingsPanel);
  if (section === 'capability-presets') return preload(loadCapabilityPresetsSettingsPanel);
  if (section === 'agent-browser') return preload(loadAgentBrowserSettingsPage);
}

export function preloadRouteForPath(to: string) {
  if (!to.startsWith('/')) return;

  const path = pathWithoutSearch(to);

  if (path === '/skills') return preload(loadSkillsPage);
  if (path === '/you') return preload(loadUserContextPage);
  if (path === '/connectors') return preload(loadConnectorsPage);
  if (path === '/automations') return preload(loadAutomationsPage);
  if (path === '/work') return preload(loadWorkPage);
  if (path === '/projects') return preload(loadProjectsPage);
  if (path.startsWith('/projects/')) return preload(loadProjectDetailPage);
  if (path.startsWith('/work-items/')) return preload(loadWorkItemDetailPage);
  if (path === '/goals') return preload(loadGoalsPage);
  if (path.startsWith('/goals/')) return preload(loadGoalDetailPage);
  if (path === '/notes') return preload(loadNotesPage);
  if (path.startsWith('/notes/')) return preload(loadNotesPage);
  if (path === '/workflows' || path.startsWith('/workflows/')) return preload(loadWorkflowsPage);
  if (path === '/channels' || path.startsWith('/channels/')) return preload(loadChannelsPage);
  if (path === '/agents' || path.startsWith('/agents/')) return preload(loadAgentsSettingsPage);
  if (path === '/extensions') return preload(loadExtensionsPage);
  if (path.startsWith('/extensions/')) return preload(loadExtensionPage);
  if (path === '/local-apps') return preload(loadLocalAppsPage);
  if (path.startsWith('/local-apps/')) return preload(loadLocalAppWorkbenchPage);
  if (path.startsWith('/share/')) return preload(loadSharePreviewPage);

  if (path === '/settings/sessions') return preload(loadSessionsPage);
  if (path === '/settings/logs') return preload(loadLogsPage);
  if (path === '/settings/extensions/debug') return preload(loadExtensionDebugPage);
  if (path.startsWith('/settings/ext/')) return preload(loadExtensionSettingsPage);
  if (path.startsWith('/settings/')) return preloadSettingsSection(path);
}
