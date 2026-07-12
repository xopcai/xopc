import { describe, expect, it } from 'vitest';

import { resolveShellChromeLayout } from './chrome-layout';

describe('resolveShellChromeLayout', () => {
  it('keeps web quick actions in the sidebar and moves them into the header when collapsed', () => {
    expect(
      resolveShellChromeLayout({ runtime: 'web', sidebarCollapsed: false, mobileNavOpen: false }),
    ).toMatchObject({
      sidebarChromeVisible: true,
      sidebarQuickActionsVisible: true,
      mainHeaderQuickActionsVisible: false,
      collapsedNewChatVisible: false,
    });

    expect(
      resolveShellChromeLayout({ runtime: 'web', sidebarCollapsed: true, mobileNavOpen: false }),
    ).toMatchObject({
      sidebarQuickActionsVisible: true,
      mainHeaderQuickActionsVisible: true,
      collapsedNewChatVisible: true,
    });
  });

  it('uses the Windows titlebar and Linux native menu instead of duplicate sidebar actions', () => {
    for (const runtime of ['win32', 'linux'] as const) {
      expect(
        resolveShellChromeLayout({ runtime, sidebarCollapsed: false, mobileNavOpen: false }),
      ).toMatchObject({
        sidebarChromeVisible: false,
        sidebarQuickActionsVisible: false,
        mainHeaderQuickActionsVisible: false,
        mainHeaderDraggable: false,
      });
    }
  });

  it('keeps macOS actions beside traffic lights when expanded and in the header when collapsed', () => {
    expect(
      resolveShellChromeLayout({ runtime: 'darwin', sidebarCollapsed: false, mobileNavOpen: false }),
    ).toMatchObject({
      sidebarChromeVisible: true,
      sidebarQuickActionsVisible: true,
      sidebarLeadingInsetClass: 'pl-[88px]',
      mainHeaderQuickActionsVisible: false,
      sidebarChromeDraggable: true,
    });

    expect(
      resolveShellChromeLayout({ runtime: 'darwin', sidebarCollapsed: true, mobileNavOpen: false }),
    ).toMatchObject({
      sidebarQuickActionsVisible: false,
      mainHeaderQuickActionsVisible: true,
      mainHeaderLeadingInsetClass: 'pl-[88px]',
      mainHeaderDraggable: true,
      collapsedNewChatVisible: false,
    });
  });
});
