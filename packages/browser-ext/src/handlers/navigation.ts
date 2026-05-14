/**
 * Navigation handlers — open, navigate, reload, back, forward, get_url, get_title.
 */

import type { ExtensionCommand, ExtensionResult } from '../protocol';
import { getActiveTabId, waitForTabLoad, resetWindowIdleTimer } from '../session-manager';
import { showOverlayOnTab, hideOverlayOnTab } from '../content-bridge';

export async function handleOpen(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const url = cmd.args?.url as string;
  if (!url) return { id: cmd.id, ok: false, error: 'Missing required arg: url' };

  const tabId = cmd.tabId ?? await getActiveTabId();
  await showOverlayOnTab(tabId, 'operating');

  try {
    await chrome.tabs.update(tabId, { url });
    await waitForTabLoad(tabId, cmd.timeout ?? 30000);
    resetWindowIdleTimer();

    const tab = await chrome.tabs.get(tabId);
    await hideOverlayOnTab(tabId);

    if (tab.groupId != null) {
      await chrome.tabGroups.update(tab.groupId, { collapsed: false }).catch(() => {});
    }
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});

    return {
      id: cmd.id,
      ok: true,
      data: { url: tab.url, title: tab.title, tabId },
    };
  } catch (e) {
    await hideOverlayOnTab(tabId);
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleNavigate(cmd: ExtensionCommand): Promise<ExtensionResult> {
  return handleOpen(cmd);
}

export async function handleReload(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  await showOverlayOnTab(tabId, 'operating');

  try {
    await chrome.tabs.reload(tabId);
    await waitForTabLoad(tabId, cmd.timeout ?? 30000);
    resetWindowIdleTimer();

    const tab = await chrome.tabs.get(tabId);
    await hideOverlayOnTab(tabId);

    return { id: cmd.id, ok: true, data: { url: tab.url, title: tab.title } };
  } catch (e) {
    await hideOverlayOnTab(tabId);
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleBack(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    await chrome.tabs.goBack(tabId);
    await waitForTabLoad(tabId, cmd.timeout ?? 10000);
    const tab = await chrome.tabs.get(tabId);
    return { id: cmd.id, ok: true, data: { url: tab.url, title: tab.title } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleForward(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    await chrome.tabs.goForward(tabId);
    await waitForTabLoad(tabId, cmd.timeout ?? 10000);
    const tab = await chrome.tabs.get(tabId);
    return { id: cmd.id, ok: true, data: { url: tab.url, title: tab.title } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleGetUrl(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    const tab = await chrome.tabs.get(tabId);
    return { id: cmd.id, ok: true, data: { url: tab.url } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleGetTitle(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    const tab = await chrome.tabs.get(tabId);
    return { id: cmd.id, ok: true, data: { title: tab.title } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
