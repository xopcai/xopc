import { XopcMobileRoute } from '../model/home';
import { XopcNotificationRoute } from './notificationRoute';

export type XopcCoreMobileTab = 'ada' | 'conversations' | 'workbench' | 'notes' | 'library';
export type XopcMobileTab = XopcCoreMobileTab | string;

export const CORE_MOBILE_TABS: XopcCoreMobileTab[] = ['ada', 'conversations', 'workbench', 'notes', 'library'];
export const PINNED_SPACE_TAB_PREFIX: string = 'pinnedSpace:';

export const FLOATING_TAB_BAR_HEIGHT_VP: number = 62;
export const FLOATING_TAB_BAR_MARGIN_BOTTOM_VP: number = 8;
export const FLOATING_TAB_BAR_COMPOSER_GAP_VP: number = 10;

export type XopcTabTapResult = 'switched' | 'popped-to-root' | 'scroll-to-top';
export type XopcBackAction = 'overlay' | 'sidebar' | 'pop' | 'switch-ada' | 'system';

export interface XopcStackTransition {
  tab: XopcMobileTab;
  operation: 'push' | 'replace' | 'pop' | 'clear' | 'noop';
  route?: XopcMobileRoute;
}

export interface XopcSearchOpenResult {
  tab: XopcMobileTab;
  operation: 'switch-ada-root' | 'push';
  route?: XopcMobileRoute;
}

export interface XopcNotificationPlan {
  tab: XopcMobileTab;
  routes: XopcMobileRoute[];
}

export interface XopcSessionUnavailableResult {
  popped: boolean;
  tab?: XopcMobileTab;
}

export interface XopcSpaceOpenResult {
  tab: XopcMobileTab;
  operation: 'switch-tab' | 'push';
  route?: XopcMobileRoute;
}

export function pinnedSpaceTabId(spaceId: string): XopcMobileTab {
  return PINNED_SPACE_TAB_PREFIX + spaceId;
}

export function isPinnedSpaceTab(tab: XopcMobileTab): boolean {
  return tab.startsWith(PINNED_SPACE_TAB_PREFIX) && tab.length > PINNED_SPACE_TAB_PREFIX.length;
}

export function pinnedSpaceIdFromTab(tab: XopcMobileTab): string {
  return isPinnedSpaceTab(tab) ? tab.slice(PINNED_SPACE_TAB_PREFIX.length) : '';
}

export function shouldShowBottomTabBar(
  activeStackDepth: number,
  keyboardVisible: boolean,
  fullScreenOverlayActive: boolean,
): boolean {
  return activeStackDepth === 0 && !keyboardVisible && !fullScreenOverlayActive;
}

export function shouldAllowSidebarEdgeSwipe(
  activeStackDepth: number,
  sidebarMounted: boolean,
  fullScreenOverlayActive: boolean,
): boolean {
  return activeStackDepth === 0 && !sidebarMounted && !fullScreenOverlayActive;
}

export function shouldMarkPersonalViewed(
  selectedTab: XopcMobileTab,
  activeStackDepth: number,
  sidebarMounted: boolean,
  foreground: boolean,
  fullScreenOverlayActive: boolean,
): boolean {
  return selectedTab === 'ada' && activeStackDepth === 0 && !sidebarMounted && foreground && !fullScreenOverlayActive;
}

export function bottomChromeInsetFor(showBottomTabBar: boolean): number {
  return showBottomTabBar ? FLOATING_TAB_BAR_HEIGHT_VP + FLOATING_TAB_BAR_MARGIN_BOTTOM_VP : 0;
}

export function isActiveMobileDestination(
  selectedTab: XopcMobileTab, topEntries: Map<XopcMobileTab, number>, entryId?: number,
): boolean {
  return entryId !== undefined && topEntries.get(selectedTab) === entryId;
}

export function synthesizeNotificationPlan(
  route: XopcNotificationRoute,
  personalConversationId: string,
): XopcNotificationPlan {
  const target = route.target;
  if (target.kind === 'home') {
    return { tab: 'ada', routes: [] };
  }
  if (target.kind === 'task' && target.taskId) {
    const routes: XopcMobileRoute[] = [{ page: 'task-detail', itemId: target.taskId }];
    if (target.conversationId) {
      routes.push({
        page: 'task-conversation',
        itemId: target.taskId,
        prompt: target.conversationId,
      });
    }
    return { tab: 'workbench', routes };
  }
  if (target.kind === 'automation_run' && target.runId) {
    return {
      tab: 'workbench',
      routes: [
        { page: 'automations', itemId: target.automationId ?? '' },
        { page: 'automation-run', itemId: target.runId },
      ],
    };
  }
  if (target.conversationId) {
    if (personalConversationId && target.conversationId === personalConversationId) {
      return { tab: 'ada', routes: [] };
    }
    return {
      tab: 'conversations',
      routes: [{ page: 'session-chat', itemId: target.conversationId }],
    };
  }
  return { tab: 'ada', routes: [] };
}

/**
 * Pure multi-stack navigation state machine shared by HomeView and host unit tests.
 * Keeps 5 core tab stacks (plus extensible pinnedSpace:<id> tabs) strictly isolated.
 */
export class XopcMobileTabNavState {
  selectedTab: XopcMobileTab = 'ada';
  sidebarOpen: boolean = false;
  pinnedSpaceIds: string[] = [];
  private stacks: Map<XopcMobileTab, XopcMobileRoute[]> = new Map<XopcMobileTab, XopcMobileRoute[]>();

  constructor() {
    this.initCoreStacks();
  }

  private initCoreStacks(): void {
    for (const tab of CORE_MOBILE_TABS) {
      if (!this.stacks.has(tab)) this.stacks.set(tab, []);
    }
  }

  private ensureStack(tab: XopcMobileTab): XopcMobileRoute[] {
    let stack = this.stacks.get(tab);
    if (!stack) {
      stack = [];
      this.stacks.set(tab, stack);
    }
    return stack;
  }

  stackFor(tab: XopcMobileTab): XopcMobileRoute[] {
    return this.ensureStack(tab).slice();
  }

  activeStack(): XopcMobileRoute[] {
    return this.stackFor(this.selectedTab);
  }

  stackDepth(tab: XopcMobileTab): number {
    return this.ensureStack(tab).length;
  }

  activeStackDepth(): number {
    return this.stackDepth(this.selectedTab);
  }

  topRoute(tab: XopcMobileTab = this.selectedTab): XopcMobileRoute | undefined {
    const stack = this.ensureStack(tab);
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  }

  selectTab(tab: XopcMobileTab): XopcTabTapResult {
    this.ensureStack(tab);
    if (tab !== this.selectedTab) {
      this.selectedTab = tab;
      return 'switched';
    }
    const stack = this.ensureStack(tab);
    if (stack.length > 0) {
      stack.length = 0;
      return 'popped-to-root';
    }
    return 'scroll-to-top';
  }

  pushOnTab(tab: XopcMobileTab, route: XopcMobileRoute): XopcStackTransition {
    const stack = this.ensureStack(tab);
    if (route.page === 'task-conversation') {
      const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
      if (top && top.page === 'task-conversation' && top.itemId === route.itemId) {
        return { tab, operation: 'noop' };
      }
      const previous = stack.length > 1 ? stack[stack.length - 2] : undefined;
      if (top?.page === 'task-detail' && previous?.page === 'task-conversation' && previous.itemId === route.itemId) {
        stack.pop();
        return { tab, operation: 'pop' };
      }
    }
    stack.push(route);
    return { tab, operation: 'push', route };
  }

  pushOnActiveTab(route: XopcMobileRoute): XopcStackTransition {
    return this.pushOnTab(this.selectedTab, route);
  }

  popTab(tab: XopcMobileTab = this.selectedTab): XopcMobileRoute | undefined {
    const stack = this.ensureStack(tab);
    return stack.pop();
  }

  clearTab(tab: XopcMobileTab): void {
    this.ensureStack(tab).length = 0;
  }

  syncStack(tab: XopcMobileTab, routes: XopcMobileRoute[]): void {
    this.stacks.set(tab, routes.slice());
  }

  openSidebarLowFrequencyRoute(route: XopcMobileRoute): XopcStackTransition {
    this.sidebarOpen = false;
    return this.pushOnActiveTab(route);
  }

  openSessionChat(route: XopcMobileRoute): XopcStackTransition {
    this.sidebarOpen = false;
    this.selectedTab = 'conversations';
    const stack = this.ensureStack('conversations');
    const normalized: XopcMobileRoute = {
      page: 'session-chat',
      itemId: route.itemId,
      title: route.title,
      prompt: route.prompt,
      projectId: route.projectId,
      draftId: route.draftId,
      agentId: route.agentId,
    };
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (top && top.page === 'session-chat') {
      stack[stack.length - 1] = normalized;
      return { tab: 'conversations', operation: 'replace', route: normalized };
    }
    stack.push(normalized);
    return { tab: 'conversations', operation: 'push', route: normalized };
  }

  openSessionChatFromSidebar(route: XopcMobileRoute): XopcStackTransition {
    return this.openSessionChat(route);
  }

  switchSessionChatInPlace(route: XopcMobileRoute): XopcStackTransition {
    const stack = this.ensureStack(this.selectedTab);
    const normalized: XopcMobileRoute = {
      page: 'session-chat',
      itemId: route.itemId,
      title: route.title,
      prompt: route.prompt,
      projectId: route.projectId,
      draftId: route.draftId,
      agentId: route.agentId,
    };
    const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (top && top.page === 'session-chat') {
      stack[stack.length - 1] = normalized;
      return { tab: this.selectedTab, operation: 'replace', route: normalized };
    }
    return this.openSessionChat(normalized);
  }

  openConversationFromSearch(conversationId: string, personalConversationId: string): XopcSearchOpenResult {
    this.sidebarOpen = false;
    if (personalConversationId && conversationId === personalConversationId) {
      this.selectedTab = 'ada';
      this.clearTab('ada');
      return { tab: 'ada', operation: 'switch-ada-root' };
    }
    const route: XopcMobileRoute = { page: 'session-chat', itemId: conversationId };
    this.pushOnActiveTab(route);
    return { tab: this.selectedTab, operation: 'push', route };
  }

  private sessionCandidateTabs(): XopcMobileTab[] {
    const candidates: XopcMobileTab[] = [this.selectedTab];
    if (!candidates.includes('conversations')) candidates.push('conversations');
    if (!candidates.includes('ada')) candidates.push('ada');
    return candidates;
  }

  promoteSessionChatDraft(draftId: string, conversationId: string): boolean {
    if (!conversationId) return false;
    const candidates = this.sessionCandidateTabs();
    for (const tab of candidates) {
      const stack = this.ensureStack(tab);
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      if (top.page !== 'session-chat') continue;
      if (top.itemId === draftId || top.draftId === draftId || (!top.itemId && !draftId)) {
        top.itemId = conversationId;
        top.draftId = undefined;
        return true;
      }
    }
    return false;
  }

  handleSessionUnavailable(conversationId: string): XopcSessionUnavailableResult {
    if (!conversationId) return { popped: false };
    const candidates = this.sessionCandidateTabs();
    for (const tab of candidates) {
      const stack = this.ensureStack(tab);
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      if (top.page === 'session-chat' && (top.itemId === conversationId || top.draftId === conversationId)) {
        stack.pop();
        return { popped: true, tab };
      }
    }
    return { popped: false };
  }

  openSpace(spaceId: string): XopcSpaceOpenResult {
    this.sidebarOpen = false;
    if (this.pinnedSpaceIds.includes(spaceId)) {
      const tab = pinnedSpaceTabId(spaceId);
      this.ensureStack(tab);
      this.selectedTab = tab;
      return { tab, operation: 'switch-tab' };
    }
    this.selectedTab = 'library';
    const route: XopcMobileRoute = { page: 'library', itemId: spaceId };
    this.pushOnTab('library', route);
    return { tab: 'library', operation: 'push', route };
  }

  applyNotificationRoute(route: XopcNotificationRoute, personalConversationId: string): XopcNotificationPlan {
    const plan = synthesizeNotificationPlan(route, personalConversationId);
    this.sidebarOpen = false;
    this.selectedTab = plan.tab;
    this.stacks.set(plan.tab, plan.routes.slice());
    return plan;
  }

  resolveBackPress(hasOverlayOrKeyboard: boolean): XopcBackAction {
    if (hasOverlayOrKeyboard) return 'overlay';
    if (this.sidebarOpen) {
      this.sidebarOpen = false;
      return 'sidebar';
    }
    if (this.activeStackDepth() > 0) {
      this.popTab(this.selectedTab);
      return 'pop';
    }
    if (this.selectedTab !== 'ada') {
      this.selectedTab = 'ada';
      return 'switch-ada';
    }
    return 'system';
  }

  resetForGatewaySwitch(): void {
    this.stacks.clear();
    this.initCoreStacks();
    this.sidebarOpen = false;
    this.selectedTab = 'ada';
  }
}
