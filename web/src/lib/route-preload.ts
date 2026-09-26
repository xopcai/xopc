export const loadSessionsPage = () => import('@/pages/sessions-page');
export const loadUsagePage = () => import('@/pages/usage-page');
export const loadAutomationsPage = () => import('@/pages/automations-page');
export const loadScenesPage = () => import('@/features/scenes/scenes-page');
export const loadBrowserAutomationsPage = () => import('@/pages/browser-automations-page');
export const loadHomePage = () => import('@/pages/home-page');
export const loadTaskDetailPage = () => import('@/pages/task-detail-page');
export const loadProjectsPage = () => import('@/pages/projects-page');
export const loadProjectDetailPage = () => import('@/pages/project-detail-page');
export const loadNotesPage = () => import('@/pages/notes-page');
export const loadWorkflowsPage = () => import('@/pages/workflows-page');
export const loadCapabilitiesPage = () => import('@/features/capabilities/capabilities-page');
export const loadUserModelPage = () => import('@/features/user-model/user-model-page');
export const loadLogsPage = () => import('@/pages/logs-page');
export const loadSettingsPage = () => import('@/pages/settings-page');
export const loadAgentBrowserSettingsPage = () => import('@/features/settings/browser/browser-settings-page');
export const loadComputerSettingsPage = () => import('@/features/settings/computer/computer-settings-page');
export const loadExtensionPage = () => import('@/features/extensions/extension-page');
export const loadExtensionSettingsPage = () => import('@/features/extensions/extension-settings-page');
export const loadExtensionDebugPage = () => import('@/features/extensions/extension-debug-page');
export const loadSharePreviewPage = () => import('@/pages/share-preview-page');
export const loadLocalAppsPage = () => import('@/pages/local-apps-page');
export const loadLocalAppWorkbenchPage = () => import('@/pages/local-app-workbench-page');
export const loadProductOpenPage = () => import('@/pages/product-open-page');
export const loadWorkDiscoveryPage = () => import('@/features/work-discovery/work-discovery-page');
export const loadWorkDiscoveryOverlay = () => import('@/features/work-discovery/work-discovery-overlay');
export const loadSetupStatusPanel = () => import('@/features/settings/setup-checklist/setup-status-panel');
export const loadAppearanceSettingsPanel = () => import('@/features/settings/appearance-settings');
export const loadKeyboardShortcutsSettingsPanel = () => import('@/features/settings/keyboard-shortcuts-settings');
export const loadSystemSettingsPanel = () => import('@/features/settings/system-settings-panel');
export const loadDesktopPetSettingsPanel = () => import('@/features/desktop-pet/desktop-pet-settings');
export const loadAppManagementSettingsPanel = () => import('@/features/settings/app-management-settings-panel');
export const loadCapabilitiesSettingsPanel = () => import('@/features/settings/models-hub/capabilities-settings-panel');
export const loadGatewaySettingsPanel = () => import('@/features/settings/gateway-settings');
export const loadRuntimeToolsSettingsPanel = () =>
  import('@/features/settings/runtime-tools/runtime-tools-settings-panel');
export const loadRemoteAccessHub = () => import('@/features/remote-access/remote-access-hub');
export const loadSharesSettingsPanel = () => import('@/features/shares/shares-settings');
export const loadAgentDefaultsSettingsPanel = () =>
  import('@/features/settings/agent-defaults/agent-defaults-settings-panel');
export const loadEndpointToolsManagementSettings = () =>
  import('@/features/endpoint-tools/management-settings');

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
  if (section === 'system') return preload(loadSystemSettingsPanel);
  if (section === 'desktop-pet') return preload(loadDesktopPetSettingsPanel);
  if (section === 'desktop-app') return preload(loadAppManagementSettingsPanel);
  if (section.startsWith('capabilities/')) return preload(loadCapabilitiesSettingsPanel);
  if (section === 'gateway') return preload(loadGatewaySettingsPanel);
  if (section === 'runtimes') return preload(loadRuntimeToolsSettingsPanel);
  if (section === 'devices') return preload(loadEndpointToolsManagementSettings);
  if (section === 'tunnel' || section === 'remote-access') return preload(loadRemoteAccessHub);
  if (section === 'shares') return preload(loadSharesSettingsPanel);
  if (section === 'agent-defaults') return preload(loadAgentDefaultsSettingsPanel);
  if (section === 'agent-browser') return preload(loadAgentBrowserSettingsPage);
  if (section === 'computer-use') return preload(loadComputerSettingsPage);
}

export function preloadRouteForPath(to: string) {
  if (!to.startsWith('/')) return;

  const path = pathWithoutSearch(to);

  if (path === '/capabilities' || path.startsWith('/capabilities/')) return preload(loadCapabilitiesPage);
  if (path === '/user-model') return preload(loadUserModelPage);
  if (path === '/automations') return preload(loadAutomationsPage);
  if (path === '/scenes' || path.startsWith('/scenes/')) return preload(loadScenesPage);
  if (path === '/browser-automations') return preload(loadBrowserAutomationsPage);
  if (path === '/') return preload(loadHomePage);
  if (path.startsWith('/tasks/')) return preload(loadTaskDetailPage);
  if (path === '/projects') return preload(loadProjectsPage);
  if (path.startsWith('/projects/')) return preload(loadProjectDetailPage);
  if (path === '/notes') return preload(loadNotesPage);
  if (path.startsWith('/notes/')) return preload(loadNotesPage);
  if (path === '/workflows' || path.startsWith('/workflows/')) return preload(loadWorkflowsPage);
  if (path.startsWith('/extensions/')) return preload(loadExtensionPage);
  if (path === '/local-apps') return preload(loadLocalAppsPage);
  if (path.startsWith('/local-apps/')) return preload(loadLocalAppWorkbenchPage);
  if (path === '/open') return preload(loadProductOpenPage);
  if (path === '/onboarding/workspace') return preload(loadWorkDiscoveryPage);
  if (path.startsWith('/share/')) return preload(loadSharePreviewPage);

  if (path === '/settings/sessions') return preload(loadSessionsPage);
  if (path === '/settings/usage') return preload(loadUsagePage);
  if (path === '/settings/logs') return preload(loadLogsPage);
  if (path === '/settings/extensions/debug') return preload(loadExtensionDebugPage);
  if (path.startsWith('/settings/ext/')) return preload(loadExtensionSettingsPage);
  if (path.startsWith('/settings/')) return preloadSettingsSection(path);
}
