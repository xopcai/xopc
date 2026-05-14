/**
 * Element handlers — click, querySelector, evaluate, wait, scroll.
 */

import type { ExtensionCommand, ExtensionResult } from '../protocol';
import * as cdp from '../cdp';
import { getActiveTabId } from '../session-manager';
import { showClickRippleOnTab, showHoverHighlightOnTab, showScrollIndicatorOnTab } from '../content-bridge';

export async function handleClick(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const selector = cmd.args?.selector as string | undefined;
  const text = cmd.args?.text as string | undefined;

  try {
    let x: number, y: number;

    if (selector) {
      await showHoverHighlightOnTab(tabId, selector);
      const box = await cdp.evaluate(tabId, `(() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (!box || typeof box !== 'object') {
        return { id: cmd.id, ok: false, error: `Element not found: ${selector}` };
      }
      const coords = box as { x: number; y: number };
      x = coords.x;
      y = coords.y;
    } else if (text) {
      const box = await cdp.evaluate(tabId, `(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.trim().includes('${text.replace(/'/g, "\\'")}')) {
            const el = walker.currentNode.parentElement;
            if (el) { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
          }
        }
        return null;
      })()`);
      if (!box || typeof box !== 'object') {
        return { id: cmd.id, ok: false, error: `Element with text not found: ${text}` };
      }
      const coords = box as { x: number; y: number };
      x = coords.x;
      y = coords.y;
    } else if (cmd.args?.x !== undefined && cmd.args?.y !== undefined) {
      x = cmd.args.x as number;
      y = cmd.args.y as number;
    } else {
      return { id: cmd.id, ok: false, error: 'Click requires selector, text, or x/y coordinates' };
    }

    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await showClickRippleOnTab(tabId, x, y);

    return { id: cmd.id, ok: true, data: { x, y, selector, text } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleScroll(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const deltaY = (cmd.args?.deltaY as number) ?? (cmd.args?.direction === 'up' ? -300 : 300);

  try {
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 640, y: 360,
      deltaX: 0, deltaY,
    });
    await showScrollIndicatorOnTab(tabId, deltaY > 0 ? 'down' : 'up');
    return { id: cmd.id, ok: true, data: { deltaY } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleEvaluate(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const expression = cmd.args?.expression as string;
  if (!expression) return { id: cmd.id, ok: false, error: 'Missing required arg: expression' };

  try {
    const result = await cdp.evaluate(tabId, expression);
    return { id: cmd.id, ok: true, data: { result } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleWait(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const selector = cmd.args?.selector as string | undefined;
  const timeout = cmd.timeout ?? 10000;

  if (!selector) {
    const ms = cmd.args?.ms as number ?? 1000;
    await new Promise(r => setTimeout(r, ms));
    return { id: cmd.id, ok: true, data: { waited: ms } };
  }

  try {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = await cdp.evaluate(tabId, `!!document.querySelector('${selector}')`);
      if (found) return { id: cmd.id, ok: true, data: { selector, elapsed: Date.now() - start } };
      await new Promise(r => setTimeout(r, 200));
    }
    return { id: cmd.id, ok: false, error: `Timeout waiting for selector: ${selector}` };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleQuerySelector(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const selector = cmd.args?.selector as string;
  if (!selector) return { id: cmd.id, ok: false, error: 'Missing required arg: selector' };

  try {
    const result = await cdp.evaluate(tabId, `(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), text: el.textContent?.slice(0, 200), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    })()`);
    return { id: cmd.id, ok: true, data: result };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
