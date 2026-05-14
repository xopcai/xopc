/**
 * Automation session — tabs in a named tab group (no extra popup window).
 *
 * - Nothing is created on extension install / WS connect; first daemon command lazily creates the group.
 * - Tabs live in the last-focused normal Chrome window under group title {@link XOPC_TAB_GROUP_TITLE}.
 */

import { createLogger } from './logger';
import { hideOverlayOnTab } from './content-bridge';

const log = createLogger('SessionManager');

/** Tab group label shown in Chrome for xopc-controlled tabs. */
export const XOPC_TAB_GROUP_TITLE = 'xopc';

// ── Types ────────────────────────────────────────────────────────────

export interface AutomationSession {
  windowId: number;
  /** Chrome tab group id (Tab Groups API). */
  groupId: number;
  tabIds: number[];
  activeTabId: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleDeadlineAt: number;
  createdAt: number;
}

// ── State ────────────────────────────────────────────────────────────

export const automationSessions = new Map<string, AutomationSession>();
export const initScripts = new Map<number, string[]>();
export const networkListeners = new Map<
  string,
  { tabId: number; type: 'request' | 'response' }
>();

export const WINDOW_IDLE_TIMEOUT = 120_000;
export const DEFAULT_WORKSPACE = 'default';

// ── Idle timer ───────────────────────────────────────────────────────

export function resetWindowIdleTimer(workspace: string = DEFAULT_WORKSPACE): void {
  const session = automationSessions.get(workspace);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleDeadlineAt = Date.now() + WINDOW_IDLE_TIMEOUT;
  session.idleTimer = setTimeout(async () => {
    const current = automationSessions.get(workspace);
    if (!current) return;
    try {
      const tabs = await chrome.tabs.query({ groupId: current.groupId });
      for (const t of tabs) {
        if (t.id != null) await chrome.tabs.remove(t.id).catch(() => {});
      }
    } catch {
      /* */
    }
    automationSessions.delete(workspace);
    log.info('Automation tab group cleared due to idle timeout', { workspace });
  }, WINDOW_IDLE_TIMEOUT);
}

// ── Window / group management ─────────────────────────────────────────

export async function waitForTabLoad(tabId: number, timeoutMs = 30000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    });
  });
}

async function resolveTargetWindowId(): Promise<number> {
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  if (w?.id != null) return w.id;
  const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const first = all.find((x) => x.id != null);
  if (first?.id != null) return first.id;
  throw new Error('No normal browser window — open a Chrome window, then run automation again.');
}

/** Lazily create or refresh the xopc tab group in the current normal window. */
export async function getOrCreateAutomationWindow(workspace = DEFAULT_WORKSPACE): Promise<AutomationSession> {
  const existing = automationSessions.get(workspace);
  if (existing) {
    try {
      await chrome.tabGroups.get(existing.groupId);
      const tabsInGroup = await chrome.tabs.query({ groupId: existing.groupId });
      if (tabsInGroup.length === 0) throw new Error('empty group');
      existing.tabIds = tabsInGroup.map((t) => t.id!).filter(Boolean);
      const active = tabsInGroup.find((t) => t.active);
      existing.activeTabId = active?.id ?? tabsInGroup[0]?.id ?? null;
      resetWindowIdleTimer(workspace);
      return existing;
    } catch {
      automationSessions.delete(workspace);
    }
  }

  const windowId = await resolveTargetWindowId();
  // Inactive blank tab: no focus steal; CDP can attach to about:blank.
  const tab = await chrome.tabs.create({
    windowId,
    url: 'about:blank',
    active: false,
  });
  if (tab.id == null) throw new Error('Failed to create automation tab');

  const groupId = await chrome.tabs.group({
    tabIds: [tab.id],
    createProperties: { windowId },
  });

  await chrome.tabGroups.update(groupId, {
    title: XOPC_TAB_GROUP_TITLE,
    collapsed: false,
    color: 'blue',
  });

  const session: AutomationSession = {
    windowId,
    groupId,
    tabIds: [tab.id],
    activeTabId: tab.id,
    idleTimer: null,
    idleDeadlineAt: 0,
    createdAt: Date.now(),
  };

  automationSessions.set(workspace, session);
  resetWindowIdleTimer(workspace);
  log.info('Created automation tab group', { workspace, windowId, groupId, tabId: tab.id });
  return session;
}

export async function getActiveTabId(workspace = DEFAULT_WORKSPACE): Promise<number> {
  const session = await getOrCreateAutomationWindow(workspace);
  if (session.activeTabId != null) {
    const ok = await chrome.tabs.get(session.activeTabId).catch(() => null);
    if (ok) return session.activeTabId;
  }

  const tabs = await chrome.tabs.query({ groupId: session.groupId });
  const tabId = tabs.find((t) => t.active)?.id ?? tabs[0]?.id;
  if (tabId == null) throw new Error('No tab in xopc automation group');

  session.activeTabId = tabId;
  return tabId;
}

/** Add a tab to the xopc group (creates session if needed). */
export async function addTabToAutomationGroup(
  url: string,
  workspace = DEFAULT_WORKSPACE,
): Promise<{ tabId: number; session: AutomationSession }> {
  const session = await getOrCreateAutomationWindow(workspace);
  const tab = await chrome.tabs.create({
    windowId: session.windowId,
    url,
    active: false,
  });
  if (tab.id == null) throw new Error('Failed to create tab');
  const inGroup = await chrome.tabs.query({ groupId: session.groupId });
  const mergedIds = [...inGroup.map((t) => t.id!).filter(Boolean), tab.id];
  await chrome.tabs.group({ tabIds: mergedIds, groupId: session.groupId });
  session.activeTabId = tab.id;
  session.tabIds = mergedIds;
  resetWindowIdleTimer(workspace);
  return { tabId: tab.id, session };
}

export async function closeSession(workspace = DEFAULT_WORKSPACE): Promise<void> {
  const session = automationSessions.get(workspace);
  if (!session) return;

  if (session.idleTimer) clearTimeout(session.idleTimer);

  const tabs = await chrome.tabs.query({ groupId: session.groupId }).catch(() => []);
  for (const t of tabs) {
    if (t.id != null) await hideOverlayOnTab(t.id);
  }
  for (const t of tabs) {
    if (t.id != null) await chrome.tabs.remove(t.id).catch(() => {});
  }

  automationSessions.delete(workspace);
  log.info('Closed automation session', { workspace });
}

export async function closeAllSessions(): Promise<void> {
  for (const workspace of [...automationSessions.keys()]) {
    await closeSession(workspace);
  }
}
