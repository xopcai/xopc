import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bottomChromeInsetFor,
  CORE_MOBILE_TABS,
  FLOATING_TAB_BAR_HEIGHT_VP,
  FLOATING_TAB_BAR_MARGIN_BOTTOM_VP,
  isPinnedSpaceTab,
  pinnedSpaceIdFromTab,
  pinnedSpaceTabId,
  shouldAllowSidebarEdgeSwipe,
  shouldMarkPersonalViewed,
  shouldShowBottomTabBar,
  synthesizeNotificationPlan,
  XopcMobileTabNavState,
} from '../entry/src/main/ets/common/mobileTabNavigation.ets';

describe('HarmonyOS multi-stack mobile tab navigation', () => {
  it('enforces the global visibility, edge-swipe, bottom-inset and Ada unread formulas', () => {
    expect(CORE_MOBILE_TABS).toEqual(['ada', 'conversations', 'workbench', 'notes', 'library']);

    // showBottomTabBar = activeStackDepth === 0 && !keyboardVisible && !fullScreenOverlayActive
    expect(shouldShowBottomTabBar(0, false, false)).toBe(true);
    expect(shouldShowBottomTabBar(1, false, false)).toBe(false);
    expect(shouldShowBottomTabBar(0, true, false)).toBe(false);
    expect(shouldShowBottomTabBar(0, false, true)).toBe(false);

    // bottomChromeInset matches pill height + margin when visible, 0 when hidden
    expect(bottomChromeInsetFor(true)).toBe(FLOATING_TAB_BAR_HEIGHT_VP + FLOATING_TAB_BAR_MARGIN_BOTTOM_VP);
    expect(bottomChromeInsetFor(false)).toBe(0);

    // allowSidebarEdgeSwipe = activeStackDepth === 0 && !sidebarMounted && !fullScreenOverlayActive
    expect(shouldAllowSidebarEdgeSwipe(0, false, false)).toBe(true);
    expect(shouldAllowSidebarEdgeSwipe(1, false, false)).toBe(false);
    expect(shouldAllowSidebarEdgeSwipe(0, true, false)).toBe(false);
    expect(shouldAllowSidebarEdgeSwipe(0, false, true)).toBe(false);

    // viewedPersonal only when on Ada root, foreground, no sidebar, no overlay
    expect(shouldMarkPersonalViewed('ada', 0, false, true, false)).toBe(true);
    expect(shouldMarkPersonalViewed('ada', 1, false, true, false)).toBe(false);
    expect(shouldMarkPersonalViewed('conversations', 0, false, true, false)).toBe(false);
    expect(shouldMarkPersonalViewed('workbench', 0, false, true, false)).toBe(false);
    expect(shouldMarkPersonalViewed('ada', 0, true, true, false)).toBe(false);
    expect(shouldMarkPersonalViewed('ada', 0, false, false, false)).toBe(false);
    expect(shouldMarkPersonalViewed('ada', 0, false, true, true)).toBe(false);
  });

  it('preserves independent stacks across tab switches and handles active re-tap', () => {
    const nav = new XopcMobileTabNavState();
    expect(nav.selectedTab).toBe('ada');
    expect(nav.activeStackDepth()).toBe(0);

    // Switch to conversations and push session-chat
    expect(nav.selectTab('conversations')).toBe('switched');
    nav.pushOnActiveTab({ page: 'session-chat', itemId: 'conv-1' });
    expect(nav.stackDepth('conversations')).toBe(1);

    // Switch to workbench and push project-detail
    expect(nav.selectTab('workbench')).toBe('switched');
    nav.pushOnActiveTab({ page: 'project-detail', itemId: 'proj-1' });
    expect(nav.stackDepth('workbench')).toBe(1);

    // Switch to notes and push note detail
    expect(nav.selectTab('notes')).toBe('switched');
    nav.pushOnActiveTab({ page: 'notes', itemId: 'note-1' });
    expect(nav.stackDepth('notes')).toBe(1);

    // Switch back to workbench -> project-detail is preserved, conversations & notes untouched
    expect(nav.selectTab('workbench')).toBe('switched');
    expect(nav.topRoute('workbench')).toEqual({ page: 'project-detail', itemId: 'proj-1' });
    expect(nav.stackDepth('conversations')).toBe(1);
    expect(nav.stackDepth('notes')).toBe(1);

    // Active re-tap when depth > 0 pops to root
    expect(nav.selectTab('workbench')).toBe('popped-to-root');
    expect(nav.stackDepth('workbench')).toBe(0);

    // Active re-tap when already at root triggers scroll-to-top / reset
    expect(nav.selectTab('workbench')).toBe('scroll-to-top');

    // Switch back to conversations -> active re-tap pops session-chat, then scrolls to top
    expect(nav.selectTab('conversations')).toBe('switched');
    expect(nav.selectTab('conversations')).toBe('popped-to-root');
    expect(nav.stackDepth('conversations')).toBe(0);
    expect(nav.selectTab('conversations')).toBe('scroll-to-top');
  });

  it('hosts ordinary session-chat on conversations stack, replaces top on consecutive switches, and isolates AdaRoot', () => {
    const nav = new XopcMobileTabNavState();
    nav.selectTab('workbench');
    nav.pushOnActiveTab({ page: 'task-detail', itemId: 'task-1' });
    nav.sidebarOpen = true;

    // Opening ordinary chat A (or + New Chat from sidebar) while on workbench -> switches to conversations & pushes session-chat(A)
    const first = nav.openSessionChat({ page: 'session-chat', itemId: 'chat-a' });
    expect(first.tab).toBe('conversations');
    expect(first.operation).toBe('push');
    expect(nav.sidebarOpen).toBe(false);
    expect(nav.selectedTab).toBe('conversations');
    expect(nav.stackFor('conversations')).toEqual([{ page: 'session-chat', itemId: 'chat-a' }]);
    // Workbench and Ada stacks are untouched
    expect(nav.stackFor('workbench')).toEqual([{ page: 'task-detail', itemId: 'task-1' }]);
    expect(nav.stackDepth('ada')).toBe(0);

    // Switching straight to ordinary chat B replaces top (no infinite stacking!)
    const second = nav.switchSessionChatInPlace({ page: 'session-chat', itemId: 'chat-b' });
    expect(second.tab).toBe('conversations');
    expect(second.operation).toBe('replace');
    expect(nav.stackFor('conversations')).toEqual([{ page: 'session-chat', itemId: 'chat-b' }]);

    // Opening ordinary chat C while on session-chat(B) also replaces top
    const third = nav.openSessionChat({ page: 'session-chat', itemId: 'chat-c' });
    expect(third.tab).toBe('conversations');
    expect(third.operation).toBe('replace');
    expect(nav.stackFor('conversations')).toEqual([{ page: 'session-chat', itemId: 'chat-c' }]);

    // Single back press returns directly to Conversations root
    expect(nav.resolveBackPress(false)).toBe('pop');
    expect(nav.stackDepth('conversations')).toBe(0);
    expect(nav.selectedTab).toBe('conversations');
  });

  it('promotes new chat draft in-place without pop+push and pops back to conversations root on delete/404', () => {
    const nav = new XopcMobileTabNavState();
    nav.openSessionChat({ page: 'session-chat', itemId: 'draft-1', draftId: 'draft-1' });
    const before = nav.topRoute('conversations');

    expect(nav.promoteSessionChatDraft('draft-1', 'server-conv-42')).toBe(true);
    expect(nav.stackDepth('conversations')).toBe(1);
    expect(nav.topRoute('conversations')).toBe(before);
    expect(nav.topRoute('conversations')?.itemId).toBe('server-conv-42');
    expect(nav.topRoute('conversations')?.draftId).toBeUndefined();

    // Deleting or getting 404 on open ordinary chat pops back to conversations root
    const unavailable = nav.handleSessionUnavailable('server-conv-42');
    expect(unavailable).toEqual({ popped: true, tab: 'conversations' });
    expect(nav.stackDepth('conversations')).toBe(0);
  });

  it('pushes flattened sidebar direct entries onto whichever tab opened the drawer', () => {
    const nav = new XopcMobileTabNavState();
    nav.selectTab('conversations');
    nav.sidebarOpen = true;

    const cap = nav.openSidebarLowFrequencyRoute({ page: 'capabilities', itemId: 'channels' });
    expect(cap).toEqual({
      tab: 'conversations',
      operation: 'push',
      route: { page: 'capabilities', itemId: 'channels' },
    });
    expect(nav.sidebarOpen).toBe(false);
    expect(nav.topRoute('conversations')).toEqual({ page: 'capabilities', itemId: 'channels' });

    expect(nav.resolveBackPress(false)).toBe('pop');
    expect(nav.stackDepth('conversations')).toBe(0);
    expect(nav.selectedTab).toBe('conversations');
  });

  it('preserves search predecessor when opening ordinary chat from sessions-search and switches to AdaRoot for Ada', () => {
    const nav = new XopcMobileTabNavState();
    nav.selectTab('notes');
    nav.sidebarOpen = true;

    // Low-frequency search page pushes onto active tab (notes)
    const searchPush = nav.openSidebarLowFrequencyRoute({ page: 'sessions-search', itemId: '' });
    expect(searchPush.tab).toBe('notes');
    expect(nav.sidebarOpen).toBe(false);
    expect(nav.stackFor('notes')).toEqual([{ page: 'sessions-search', itemId: '' }]);

    // Picking an ordinary conversation pushes session-chat ABOVE sessions-search
    const ordinary = nav.openConversationFromSearch('conv-99', 'ada-main');
    expect(ordinary.tab).toBe('notes');
    expect(ordinary.operation).toBe('push');
    expect(nav.stackFor('notes')).toEqual([
      { page: 'sessions-search', itemId: '' },
      { page: 'session-chat', itemId: 'conv-99' },
    ]);

    // Back returns to sessions-search
    expect(nav.resolveBackPress(false)).toBe('pop');
    expect(nav.topRoute('notes')).toEqual({ page: 'sessions-search', itemId: '' });

    // Picking Ada from search switches to ada root and clears adaStack
    nav.pushOnTab('ada', { page: 'session-chat', itemId: 'old-chat' });
    const ada = nav.openConversationFromSearch('ada-main', 'ada-main');
    expect(ada).toEqual({ tab: 'ada', operation: 'switch-ada-root' });
    expect(nav.selectedTab).toBe('ada');
    expect(nav.stackDepth('ada')).toBe(0);
  });

  it('prevents task-conversation <-> task-detail loops on whichever tab launched it', () => {
    const nav = new XopcMobileTabNavState();
    nav.selectTab('library');
    const openTask = nav.pushOnActiveTab({ page: 'task-conversation', itemId: 'task-7', prompt: 'conv-t7' });
    expect(openTask.operation).toBe('push');
    // Duplicate push of same task-conversation is a no-op
    expect(nav.pushOnActiveTab({ page: 'task-conversation', itemId: 'task-7', prompt: 'conv-t7' }).operation).toBe('noop');

    // Open task-detail from task-conversation
    nav.pushOnActiveTab({ page: 'task-detail', itemId: 'task-7' });
    expect(nav.stackFor('library').map(r => r.page)).toEqual(['task-conversation', 'task-detail']);

    // Continue task pops task-detail back to existing task-conversation
    const resume = nav.pushOnActiveTab({ page: 'task-conversation', itemId: 'task-7', prompt: 'conv-t7' });
    expect(resume.operation).toBe('pop');
    expect(nav.stackFor('library').map(r => r.page)).toEqual(['task-conversation']);
  });

  it('synthesizes parent stacks for notification routes', () => {
    const nav = new XopcMobileTabNavState();

    expect(synthesizeNotificationPlan({ gatewayId: 'g', eventId: 'e1', target: { kind: 'home' } }, 'ada-1'))
      .toEqual({ tab: 'ada', routes: [] });

    expect(synthesizeNotificationPlan({ gatewayId: 'g', eventId: 'e2', target: { kind: 'chat', conversationId: 'ada-1' } }, 'ada-1'))
      .toEqual({ tab: 'ada', routes: [] });

    expect(synthesizeNotificationPlan({ gatewayId: 'g', eventId: 'e3', target: { kind: 'chat', conversationId: 'chat-7' } }, 'ada-1'))
      .toEqual({ tab: 'conversations', routes: [{ page: 'session-chat', itemId: 'chat-7' }] });

    expect(synthesizeNotificationPlan({ gatewayId: 'g', eventId: 'e4', target: { kind: 'task', taskId: 't-1' } }, 'ada-1'))
      .toEqual({ tab: 'workbench', routes: [{ page: 'task-detail', itemId: 't-1' }] });

    expect(synthesizeNotificationPlan({
      gatewayId: 'g', eventId: 'e5', target: { kind: 'task', taskId: 't-1', conversationId: 'tc-1' },
    }, 'ada-1')).toEqual({
      tab: 'workbench',
      routes: [
        { page: 'task-detail', itemId: 't-1' },
        { page: 'task-conversation', itemId: 't-1', prompt: 'tc-1' },
      ],
    });

    nav.applyNotificationRoute({
      gatewayId: 'g', eventId: 'e6', target: { kind: 'automation_run', runId: 'run-9', automationId: 'auto-3' },
    }, 'ada-1');
    expect(nav.selectedTab).toBe('workbench');
    expect(nav.stackFor('workbench')).toEqual([
      { page: 'automations', itemId: 'auto-3' },
      { page: 'automation-run', itemId: 'run-9' },
    ]);
  });

  it('enforces the 5-tier system back press priority and atomic gateway switch reset', () => {
    const nav = new XopcMobileTabNavState();
    nav.selectTab('notes');
    nav.pushOnActiveTab({ page: 'notes', itemId: 'n-1' });
    nav.sidebarOpen = true;

    // 1. Overlay / keyboard first
    expect(nav.resolveBackPress(true)).toBe('overlay');
    expect(nav.sidebarOpen).toBe(true);
    // 2. Sidebar second
    expect(nav.resolveBackPress(false)).toBe('sidebar');
    expect(nav.sidebarOpen).toBe(false);
    // 3. Pop active stack third
    expect(nav.resolveBackPress(false)).toBe('pop');
    expect(nav.stackDepth('notes')).toBe(0);
    // 4. Switch to ada root fourth
    expect(nav.resolveBackPress(false)).toBe('switch-ada');
    expect(nav.selectedTab).toBe('ada');
    // 5. Return to OS fifth
    expect(nav.resolveBackPress(false)).toBe('system');

    // Gateway switch clears every stack, closes sidebar, and resets to ada
    nav.selectTab('library');
    nav.pushOnActiveTab({ page: 'files', itemId: 'f-1' });
    nav.pushOnTab('ada', { page: 'session-chat', itemId: 'c-1' });
    nav.pushOnTab('workbench', { page: 'task-detail', itemId: 't-1' });
    nav.sidebarOpen = true;
    nav.resetForGatewaySwitch();
    expect(nav.selectedTab).toBe('ada');
    expect(nav.sidebarOpen).toBe(false);
    for (const tab of CORE_MOBILE_TABS) {
      expect(nav.stackDepth(tab)).toBe(0);
    }
  });

  it('supports future pinnedSpace tabs alongside core tabs', () => {
    const tab = pinnedSpaceTabId('space-alpha');
    expect(isPinnedSpaceTab(tab)).toBe(true);
    expect(pinnedSpaceIdFromTab(tab)).toBe('space-alpha');
    expect(isPinnedSpaceTab('ada')).toBe(false);

    const nav = new XopcMobileTabNavState();
    // Unpinned space pushes onto library stack
    expect(nav.openSpace('space-alpha')).toEqual({
      tab: 'library',
      operation: 'push',
      route: { page: 'library', itemId: 'space-alpha' },
    });

    // Pinned space switches to pinnedSpace tab
    nav.pinnedSpaceIds = ['space-alpha'];
    expect(nav.openSpace('space-alpha')).toEqual({
      tab: 'pinnedSpace:space-alpha',
      operation: 'switch-tab',
    });
    expect(nav.selectedTab).toBe('pinnedSpace:space-alpha');
  });

  it('mounts the 5 preserved stacks, FloatingTabBar, L0 SessionsView, initialCategory CapabilitiesView, and flattened ChatSidebar', () => {
    const home = readFileSync(new URL('../entry/src/main/ets/view/HomeView.ets', import.meta.url), 'utf8');
    const homeModel = readFileSync(new URL('../entry/src/main/ets/model/home.ets', import.meta.url), 'utf8');
    const sidebar = readFileSync(new URL('../entry/src/main/ets/view/ChatSidebar.ets', import.meta.url), 'utf8');
    const tabBar = readFileSync(new URL('../entry/src/main/ets/view/FloatingTabBar.ets', import.meta.url), 'utf8');
    const sessions = readFileSync(new URL('../entry/src/main/ets/view/SessionsView.ets', import.meta.url), 'utf8');
    const notes = readFileSync(new URL('../entry/src/main/ets/view/NotesTabView.ets', import.meta.url), 'utf8');
    const library = readFileSync(new URL('../entry/src/main/ets/view/SpaceLibraryView.ets', import.meta.url), 'utf8');
    const capabilities = readFileSync(new URL('../entry/src/main/ets/view/CapabilitiesView.ets', import.meta.url), 'utf8');

    expect(home).not.toContain('returnToSidebar');
    expect(homeModel).not.toContain('returnToSidebar');
    expect(home).toContain('private adaStack: NavPathStack = new NavPathStack();');
    expect(home).toContain('private conversationsStack: NavPathStack = new NavPathStack();');
    expect(home).toContain('private workbenchStack: NavPathStack = new NavPathStack();');
    expect(home).toContain('private notesStack: NavPathStack = new NavPathStack();');
    expect(home).toContain('private libraryStack: NavPathStack = new NavPathStack();');
    expect(home).toContain("if (page === 'session-chat')");
    expect(home).toContain('this.conversationsTabStack()');
    expect(home).toContain('initialCategory: (param as XopcMobileRoute).itemId');
    expect(home).toContain('XopcFloatingTabBar({');

    // SessionsView supports L0 root tab mode with drawer button, bottom chrome inset, and scroll-to-top
    expect(sessions).toContain('@Param rootTab: boolean = false;');
    expect(sessions).toContain('@Param bottomChromeInset: number = 0;');
    expect(sessions).toContain('@Param scrollTopRevision: number = 0;');
    expect(sessions).toContain("drawerId: 'sessions-header-sidebar'");

    // Bottom tabs (Conversations, Workbench, Notes, Library) switch via top header menu only (no horizontal swipe)
    expect(sessions).toContain('.disableSwipe(true)');
    expect(home).toContain('.disableSwipe(true)');
    expect(notes).toContain('.disableSwipe(true)');
    expect(library).toContain('.disableSwipe(true)');
    expect(library).toContain("titleMenuId: 'space-scope-menu'");

    // CapabilitiesView opens a single category directly with static title and no pager/header switching
    expect(capabilities).toContain("@Param initialCategory: string = '';");
    expect(capabilities).toContain('showStaticTitle: true');
    expect(capabilities).not.toContain('titleOptions:');
    expect(capabilities).not.toContain('Swiper(');

    // Flattened sidebar has zero duplication with bottom tabs and no recent conversations list
    expect(sidebar).not.toContain('XopcSessionsViewModel');
    expect(sidebar).not.toContain('recentConversations');
    expect(sidebar).not.toContain("'personal'");
    expect(sidebar).not.toContain("'workbench'");
    expect(sidebar).not.toContain("'notes-list'");
    expect(sidebar).not.toContain("'library'");
    for (const category of ['plugins', 'skills', 'connections', 'devices', 'agents', 'channels']) {
      expect(sidebar).toContain(`'capabilities', '${category}'`);
    }
    expect(sidebar).toContain("this.shortcut($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')");
    expect(sidebar).toContain("this.shortcut($r('app.string.sidebar_share_center'), $r('sys.symbol.share'), 'sharing')");
    expect(sidebar).toContain("this.shortcut($r('app.string.about_you'), $r('sys.symbol.person'), 'about-you')");
    expect(sidebar).toContain("this.shortcut($r('app.string.sidebar_goals'), $r('sys.symbol.flag'), 'personal-goals')");

    // FloatingTabBar defines the 5 exact core slots and matches chat input panel background
    expect(tabBar).toContain(".id('floating-tab-ada')");
    expect(tabBar).toContain("this.iconTab('conversations'");
    expect(tabBar).toContain("this.iconTab('workbench'");
    expect(tabBar).toContain("this.iconTab('notes'");
    expect(tabBar).toContain("this.iconTab('library'");
    expect(tabBar).toContain('.backgroundColor(this.colors.panel)');
    expect(tabBar).not.toContain('.backgroundBlurStyle(');
  });
});
