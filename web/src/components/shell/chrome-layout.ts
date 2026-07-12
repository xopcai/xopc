import { isElectron } from '@/lib/electron-env';

export type ShellChromeRuntime = 'web' | 'win32' | 'darwin' | 'linux';

type ResolveShellChromeLayoutInput = {
  runtime: ShellChromeRuntime;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
};

export type ShellChromeLayout = {
  sidebarChromeVisible: boolean;
  sidebarQuickActionsVisible: boolean;
  sidebarChromeDraggable: boolean;
  sidebarLeadingInsetClass: string;
  mainHeaderDraggable: boolean;
  mainHeaderQuickActionsVisible: boolean;
  mainHeaderLeadingInsetClass: string;
  collapsedNewChatVisible: boolean;
};

export function getShellChromeRuntime(): ShellChromeRuntime {
  if (!isElectron()) return 'web';
  return window.electronAPI?.platform ?? 'web';
}

export function resolveShellChromeLayout({
  runtime,
  sidebarCollapsed,
  mobileNavOpen,
}: ResolveShellChromeLayoutInput): ShellChromeLayout {
  const isDarwin = runtime === 'darwin';
  const isWeb = runtime === 'web';
  const sidebarQuickActionsVisible =
    isWeb || (isDarwin && !sidebarCollapsed && !mobileNavOpen);
  const mainHeaderQuickActionsVisible =
    (isWeb && sidebarCollapsed) || (isDarwin && sidebarCollapsed && !mobileNavOpen);

  return {
    sidebarChromeVisible: sidebarQuickActionsVisible || mobileNavOpen,
    sidebarQuickActionsVisible,
    sidebarChromeDraggable: isDarwin,
    sidebarLeadingInsetClass: isDarwin ? 'pl-[88px]' : '',
    mainHeaderDraggable: isDarwin,
    mainHeaderQuickActionsVisible,
    mainHeaderLeadingInsetClass: isDarwin && sidebarCollapsed ? 'pl-[88px]' : '',
    collapsedNewChatVisible: isWeb && sidebarCollapsed,
  };
}
