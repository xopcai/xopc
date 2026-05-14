/**
 * CDP execution via chrome.debugger API.
 *
 * Wraps chrome.debugger to provide reliable JS evaluation, screenshots,
 * input dispatching, and file input setting.
 */

import { createLogger } from './logger';

const log = createLogger('CDP');
const attached = new Set<number>();

/** Check if a URL can be attached via CDP. */
export function isDebuggableUrl(url?: string): boolean {
  if (!url) return true;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url === 'about:blank' ||
    url.startsWith('data:')
  );
}

/** Ensure chrome.debugger is attached to the given tab. */
export async function ensureAttached(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isDebuggableUrl(tab.url)) {
      attached.delete(tabId);
      throw new Error(`Cannot debug tab ${tabId}: URL is ${tab.url ?? 'unknown'}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Cannot debug tab')) throw e;
    attached.delete(tabId);
    throw new Error(`Tab ${tabId} no longer exists`);
  }

  if (attached.has(tabId)) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
      });
      return;
    } catch {
      attached.delete(tabId);
    }
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY = 500;
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      try {
        await chrome.debugger.detach({ tabId });
      } catch { /* not attached */ }

      await chrome.debugger.attach({ tabId }, '1.3');
      attached.add(tabId);

      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable', {});
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable', {});

      log.debug('Attached to tab', { tabId, attempt });
      return;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  throw new Error(`Failed to attach debugger to tab ${tabId}: ${lastError}`);
}

/** Detach from a tab. */
export async function detach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch { /* already detached */ }
  attached.delete(tabId);
}

/** Send a CDP command to a tab. */
export async function sendCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  await ensureAttached(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params ?? {});
}

/** Evaluate JS expression in the tab page context. */
export async function evaluate(tabId: number, expression: string): Promise<unknown> {
  const result = await sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };

  if (result.exceptionDetails) {
    throw new Error(`JS evaluation failed: ${result.exceptionDetails.text ?? 'unknown error'}`);
  }

  return result.result?.value;
}

/** Take a screenshot via CDP. */
export async function captureScreenshot(
  tabId: number,
  options?: { format?: 'png' | 'jpeg'; quality?: number; fullPage?: boolean },
): Promise<string> {
  if (options?.fullPage) {
    const metrics = await sendCommand(tabId, 'Page.getLayoutMetrics', {}) as {
      contentSize?: { width: number; height: number };
    };
    if (metrics.contentSize) {
      await sendCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
        width: Math.ceil(metrics.contentSize.width),
        height: Math.ceil(metrics.contentSize.height),
        deviceScaleFactor: 1,
        mobile: false,
      });
    }
  }

  const result = await sendCommand(tabId, 'Page.captureScreenshot', {
    format: options?.format ?? 'png',
    quality: options?.quality,
  }) as { data: string };

  if (options?.fullPage) {
    await sendCommand(tabId, 'Emulation.clearDeviceMetricsOverride', {});
  }

  return result.data;
}

/** Dispatch input event via CDP. */
export async function dispatchInput(
  tabId: number,
  type: string,
  params: Record<string, unknown>,
): Promise<void> {
  await sendCommand(tabId, `Input.${type}`, params);
}

/** Listen for detach events. */
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) attached.delete(source.tabId);
});
