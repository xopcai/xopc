/**
 * Input handlers — mouse and keyboard operations via CDP.
 */

import type { ExtensionCommand, ExtensionResult } from '../protocol';
import * as cdp from '../cdp';
import { getActiveTabId } from '../session-manager';
import { showClickRippleOnTab, showInputFlashOnTab } from '../content-bridge';

export async function handleMouseMove(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const x = cmd.args?.x as number ?? 0;
  const y = cmd.args?.y as number ?? 0;

  try {
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
    return { id: cmd.id, ok: true, data: { x, y } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleMouseClick(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const x = cmd.args?.x as number ?? 0;
  const y = cmd.args?.y as number ?? 0;
  const button = (cmd.args?.button as string) ?? 'left';
  const clickCount = (cmd.args?.clickCount as number) ?? 1;

  try {
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', {
      type: 'mousePressed',
      x, y, button, clickCount,
    });
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y, button, clickCount,
    });
    await showClickRippleOnTab(tabId, x, y);
    return { id: cmd.id, ok: true, data: { x, y, button } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleMouseWheel(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const x = cmd.args?.x as number ?? 0;
  const y = cmd.args?.y as number ?? 0;
  const deltaX = cmd.args?.deltaX as number ?? 0;
  const deltaY = cmd.args?.deltaY as number ?? 0;

  try {
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', {
      type: 'mouseWheel',
      x, y, deltaX, deltaY,
    });
    return { id: cmd.id, ok: true, data: { deltaX, deltaY } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleKeyboardPress(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const key = cmd.args?.key as string;
  if (!key) return { id: cmd.id, ok: false, error: 'Missing required arg: key' };

  try {
    await cdp.dispatchInput(tabId, 'dispatchKeyEvent', {
      type: 'keyDown',
      key,
      windowsVirtualKeyCode: key.length === 1 ? key.charCodeAt(0) : 0,
    });
    await cdp.dispatchInput(tabId, 'dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: key.length === 1 ? key.charCodeAt(0) : 0,
    });
    return { id: cmd.id, ok: true, data: { key } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleKeyboardType(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const text = cmd.args?.text as string;
  if (!text) return { id: cmd.id, ok: false, error: 'Missing required arg: text' };

  try {
    for (const char of text) {
      await cdp.dispatchInput(tabId, 'dispatchKeyEvent', {
        type: 'char',
        text: char,
      });
    }
    return { id: cmd.id, ok: true, data: { text } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function handleType(cmd: ExtensionCommand): Promise<ExtensionResult> {
  const tabId = cmd.tabId ?? await getActiveTabId();
  const selector = cmd.args?.selector as string;
  const text = cmd.args?.text as string;

  if (!text) return { id: cmd.id, ok: false, error: 'Missing required arg: text' };

  try {
    if (selector) {
      await cdp.evaluate(tabId, `document.querySelector('${selector}')?.focus()`);
      await showInputFlashOnTab(tabId, selector);
    }

    await cdp.sendCommand(tabId, 'Input.insertText', { text });

    if (cmd.args?.pressEnter) {
      await cdp.dispatchInput(tabId, 'dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      });
      await cdp.dispatchInput(tabId, 'dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      });
    }

    return { id: cmd.id, ok: true, data: { text, selector } };
  } catch (e) {
    return { id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
