/**
 * Page handlers — state, snapshot, screenshot, viewport, cookies, close, tabs.
 */

import type { ExtensionCommand, ExtensionResult } from '../protocol';
import * as cdp from '../cdp';
import {
  addTabToAutomationGroup,
  automationSessions,
  closeSession,
  DEFAULT_WORKSPACE,
  getActiveTabId,
} from '../session-manager';

export async function handleState(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    const tab = await chrome.tabs.get(tabId);
    return {
      id: cmd.id,
      ok: true,
      data: { url: tab.url, title: tab.title, tabId, status: tab.status },
    };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleSnapshot(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    const accessibility = await cdp.sendCommand(tabId, 'Accessibility.getFullAXTree', {}) as {
      nodes?: Array<{ role?: { value?: string }; name?: { value?: string }; nodeId?: string }>;
    };

    const nodes = accessibility.nodes?.slice(0, 200).map(n => ({
      role: n.role?.value,
      name: n.name?.value,
    })).filter(n => n.role && n.name) ?? [];

    const tab = await chrome.tabs.get(tabId);
    return {
      id: cmd.id,
      ok: true,
      data: { url: tab.url, title: tab.title, nodes, nodeCount: nodes.length },
    };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleScreenshot(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const fullPage = cmd.args?.fullPage as boolean ?? cmd.args?.full_page as boolean ?? false;

  try {
    const base64 = await cdp.captureScreenshot(tabId, {
      format: 'png',
      fullPage,
    });
    return { id: cmd.id, ok: true, data: { base64, format: 'png', fullPage } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleGetViewportSize(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  try {
    const size = await cdp.evaluate(tabId, `({ width: window.innerWidth, height: window.innerHeight })`);
    return { id: cmd.id, ok: true, data: size };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleSetViewportSize(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const width = cmd.args?.width as number ?? 1280;
  const height = cmd.args?.height as number ?? 720;

  try {
    await cdp.sendCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    return { id: cmd.id, ok: true, data: { width, height } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleClose(cmd: ExtensionCommand): Promise<ExtensionResult> {
  try {
    await closeSession();
    return { id: cmd.id, ok: true, data: { closed: true } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleNewTab(cmd: ExtensionCommand): Promise<ExtensionResult> {
  try {
    const url = cmd.args?.url as string ?? 'about:blank';
    const { tabId } = await addTabToAutomationGroup(url);
    return { id: cmd.id, ok: true, data: { tabId, url } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleListTabs(cmd: ExtensionCommand): Promise<ExtensionResult> {
  try {
    const sess = automationSessions.get(DEFAULT_WORKSPACE);
    if (!sess) {
      return { id: cmd.id, ok: true, data: { tabs: [] } };
    }
    const tabs = await chrome.tabs.query({ groupId: sess.groupId });
    return {
      id: cmd.id,
      ok: true,
      data: {
        tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })),
      },
    };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleGetCookies(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const url = cmd.args?.url as string | undefined;
  try {
    const cookies = await chrome.cookies.getAll(url ? { url } : {});
    return { id: cmd.id, ok: true, data: { cookies: cookies.slice(0, 100) } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleDialog(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const accept = cmd.args?.accept as boolean ?? true;
  const promptText = cmd.args?.text as string | undefined;

  try {
    await cdp.sendCommand(tabId, 'Page.handleJavaScriptDialog', {
      accept,
      promptText,
    });
    return { id: cmd.id, ok: true, data: { accept, promptText } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
