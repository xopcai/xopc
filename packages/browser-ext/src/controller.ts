import type {
  BrowserActionInput,
  BrowserControlResult,
  BrowserNode,
  BrowserObservation,
  BrowserWireCommand,
  BrowserWireResult,
} from './protocol';
import { BROWSER_EXTENSION_PROTOCOL_VERSION } from './protocol';
import * as cdp from './cdp';
import {
  addTabToAutomationGroup,
  automationSessions,
  closeSession,
  getActiveTabId,
  getOrCreateAutomationWindow,
  resetWindowIdleTimer,
  waitForTabLoad,
} from './session-manager';
import { TAB_BINDING_PREFIX } from './sidepanel/page-context';
import type { BrowserTabBinding } from '@xopcai/gateway-contract';

interface ObservationState {
  documentMarker: string;
  documentId: string;
  revision: number;
  nodes: BrowserNode[];
}

const observations = new Map<string, ObservationState>();

type AttachedTarget = { binding: BrowserTabBinding; tabId: number; stateKey: string };

async function markerDigest(tabId: number): Promise<string> {
  const marker = await cdp.evaluate(tabId, `({ url: location.href, timeOrigin: performance.timeOrigin })`) as {
    url: string;
    timeOrigin: number;
  };
  const url = new URL(marker.url);
  url.username = '';
  url.password = '';
  url.hash = '';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${url.toString()}\n${marker.timeOrigin}`));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function resolveAttachedTarget(input: BrowserActionInput): Promise<AttachedTarget | BrowserControlResult | undefined> {
  if (input.target?.kind !== 'attached_tab') return undefined;
  const key = `${TAB_BINDING_PREFIX}${input.target.bindingId}`;
  const stored = await chrome.storage.session.get(key);
  const binding = stored[key] as BrowserTabBinding | undefined;
  if (!binding || binding.id !== input.target.bindingId || binding.expiresAt <= Date.now()) {
    return fail('SESSION_NOT_FOUND', 'The attached tab binding is unavailable or expired.');
  }
  if (input.action === 'navigate' || input.action === 'tabs' || input.action === 'sequence') {
    return fail('INVALID_INPUT', `${input.action} is unavailable for an attached tab.`);
  }
  const needsAct = !['observe', 'wait', 'close'].includes(input.action);
  if (needsAct && binding.mode !== 'act') {
    return fail('APPROVAL_REQUIRED', 'This tab is attached in read-only mode. Enable Control tab in the side panel.');
  }
  const tabId = Number(binding.tabId);
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId).catch(() => null) : null;
  if (!tab || String(tab.windowId) !== binding.windowId || !tab.url) {
    return fail('SESSION_NOT_FOUND', 'The attached tab is no longer available.');
  }
  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return fail('UNSUPPORTED_PAGE', 'The attached tab URL is not supported.');
  }
  if (origin !== binding.urlOrigin) {
    return fail('STALE_OBSERVATION', 'The attached tab navigated to another site. Bind it again.');
  }
  if (await markerDigest(tabId) !== binding.documentId) {
    return fail('STALE_OBSERVATION', 'The attached tab document changed. Bind it again.');
  }
  return { binding, tabId, stateKey: `attached:${binding.id}` };
}

export async function executeBrowserCommand(command: BrowserWireCommand): Promise<BrowserWireResult> {
  const startedAt = Date.now();
  if (command.protocolVersion !== BROWSER_EXTENSION_PROTOCOL_VERSION) {
    return {
      id: command.id,
      connectionId: command.connectionId,
      result: fail(
        'DRIVER_UNAVAILABLE',
        `Browser protocol mismatch. Expected ${BROWSER_EXTENSION_PROTOCOL_VERSION}; reload the xopc extension.`,
      ),
    };
  }
  try {
    const result = await execute(command.input, command.timeoutMs, command.visualFallback, startedAt);
    return { id: command.id, connectionId: command.connectionId, result };
  } catch (error) {
    return {
      id: command.id,
      connectionId: command.connectionId,
      result: {
        ok: false,
        error: {
          code: /timeout/i.test(String(error)) ? 'TIMEOUT' : 'DRIVER_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

async function execute(
  input: BrowserActionInput,
  timeoutMs: number,
  visualFallback: boolean,
  startedAt: number,
): Promise<BrowserControlResult> {
  const sessionId = input.sessionId;
  if (!sessionId) return fail('INVALID_INPUT', 'Extension actions require a session id.');
  const attached = await resolveAttachedTarget(input);
  if (attached && !('binding' in attached)) return attached;
  const stateKey = attached?.stateKey ?? sessionId;
  if (input.action === 'close') {
    if (!attached) await closeSession(sessionId);
    observations.delete(stateKey);
    return success('close', 'read', startedAt);
  }
  if (input.action === 'observe') {
    const mode = input.visual === 'always' ? 'always' : input.visual === 'never' || !visualFallback ? 'never' : 'auto';
    const observation = await observe(sessionId, mode, attached);
    return success('observe', 'read', startedAt, observation);
  }
  if (input.action === 'navigate') {
    const tabId = attached?.tabId ?? await getActiveTabId(sessionId);
    await chrome.tabs.update(tabId, { url: input.url });
    await waitForTabLoad(tabId, timeoutMs);
    if (!attached) resetWindowIdleTimer(sessionId);
    const observation = await observe(sessionId, visualFallback ? 'auto' : 'never', attached);
    return verified(input, observation, startedAt, 'read');
  }
  if (input.action === 'tabs') return tabs(sessionId, input, startedAt, timeoutMs);
  if (input.action === 'sequence') return fail('INVALID_INPUT', 'Sequences are expanded by the browser runtime.');

  const current = observations.get(stateKey);
  if (!current || current.revision !== input.revision) {
    return fail('STALE_OBSERVATION', 'The page changed. Observe it again.', await observe(sessionId, 'never', attached));
  }
  const tabId = attached?.tabId ?? await getActiveTabId(sessionId);
  const ref = 'ref' in input ? input.ref : undefined;
  if (ref && !current.nodes.some((node) => node.ref === ref)) {
    return fail('TARGET_NOT_FOUND', `Target ${ref} was not found.`);
  }

  if (input.action === 'click') {
    const point = await evaluateRef(tabId, input.ref, `(element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }`);
    if (!point) return fail('TARGET_NOT_FOUND', `Target ${input.ref} was not found.`);
    const coordinates = point as { x: number; y: number };
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', { type: 'mousePressed', ...coordinates, button: 'left', clickCount: 1 });
    await cdp.dispatchInput(tabId, 'dispatchMouseEvent', { type: 'mouseReleased', ...coordinates, button: 'left', clickCount: 1 });
  } else if (input.action === 'fill') {
    const changed = await evaluateRef(tabId, input.ref, `(element, value) => {
      element.focus();
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }`, input.value);
    if (!changed) return fail('TARGET_NOT_FOUND', `Target ${input.ref} was not found.`);
    if (input.submit) await pressKey(tabId, 'Enter');
  } else if (input.action === 'select') {
    const changed = await evaluateRef(tabId, input.ref, `(element, value) => {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }`, input.value);
    if (!changed) return fail('TARGET_NOT_FOUND', `Target ${input.ref} was not found.`);
  } else if (input.action === 'press') {
    if (input.ref) await evaluateRef(tabId, input.ref, '(element) => { element.focus(); return true; }');
    await pressKey(tabId, input.key);
  } else if (input.action === 'scroll') {
    if (input.ref) {
      await evaluateRef(tabId, input.ref, '(element, deltaY) => { element.scrollBy({ top: deltaY }); return true; }', input.deltaY);
    } else {
      await cdp.dispatchInput(tabId, 'dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: input.deltaY });
    }
  } else if (input.action === 'wait') {
    await wait(tabId, input, timeoutMs);
  } else if (input.action === 'upload') {
    const document = await cdp.sendCommand(tabId, 'DOM.getDocument', { depth: 1 }) as { root: { nodeId: number } };
    const query = await cdp.sendCommand(tabId, 'DOM.querySelectorAll', {
      nodeId: document.root.nodeId,
      selector: `[data-xopc-ref="${input.ref}"]`,
    }) as { nodeIds: number[] };
    if (query.nodeIds.length !== 1) return fail('TARGET_NOT_FOUND', `Target ${input.ref} was not uniquely found.`);
    await cdp.sendCommand(tabId, 'DOM.setFileInputFiles', { nodeId: query.nodeIds[0], files: input.paths });
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  const observation = await observe(sessionId, visualFallback ? 'auto' : 'never', attached);
  return verified(input, observation, startedAt, 'draft');
}

async function observe(
  sessionId: string,
  visual: 'never' | 'auto' | 'always',
  attached?: AttachedTarget,
): Promise<BrowserObservation> {
  const tabId = attached?.tabId ?? await getActiveTabId(sessionId);
  const tab = await chrome.tabs.get(tabId);
  const raw = await cdp.evaluate(tabId, `(() => {
    const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="option"],[role="tab"],[tabindex]:not([tabindex="-1"])';
    globalThis.__xopcRefCounter = globalThis.__xopcRefCounter || 0;
    const nodes = [];
    const seenRefs = new Set();
    for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 1500)) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let ref = element.getAttribute('data-xopc-ref');
      if (!/^xopc-e\d+$/.test(ref || '') || seenRefs.has(ref)) {
        ref = 'xopc-e' + (++globalThis.__xopcRefCounter);
        element.setAttribute('data-xopc-ref', ref);
      }
      seenRefs.add(ref);
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' || tag === 'summary' ? 'button' : tag === 'select' ? 'combobox' : tag === 'input' && element.type === 'checkbox' ? 'checkbox' : tag === 'input' && element.type === 'radio' ? 'radio' : 'textbox');
      const label = element.labels?.[0]?.innerText || '';
      const name = (element.getAttribute('aria-label') || label || element.getAttribute('alt') || element.getAttribute('placeholder') || element.innerText || element.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 240);
      const states = [];
      const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
      const sensitive = element.type === 'password' || /^(cc-|one-time-code$|transaction-)/.test(autocomplete);
      if (element.disabled) states.push('disabled');
      if (element.checked) states.push('checked');
      if (document.activeElement === element) states.push('focused');
      if (element.getAttribute('aria-expanded') === 'true') states.push('expanded');
      if (sensitive) states.push('sensitive');
      if ((tag === 'button' || tag === 'input') && element.type === 'submit') states.push('submit');
      nodes.push({ ref, role, name, value: !sensitive && 'value' in element ? String(element.value || '').slice(0, 500) : undefined, states, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
      if (nodes.length >= 500) break;
    }
    return { marker: location.href + '|' + performance.timeOrigin, nodes, hasVisualSurface: !!document.querySelector('canvas,embed[type="application/pdf"],object[type="application/pdf"]') };
  })()` ) as { marker: string; nodes: BrowserNode[]; hasVisualSurface: boolean };
  const stateKey = attached?.stateKey ?? sessionId;
  const prior = observations.get(stateKey);
  const state: ObservationState = prior?.documentMarker === raw.marker
    ? { ...prior, revision: prior.revision + 1, nodes: raw.nodes }
    : {
        documentMarker: raw.marker,
        documentId: attached && !prior ? attached.binding.documentId : crypto.randomUUID(),
        revision: 1,
        nodes: raw.nodes,
      };
  const changes = diff(prior?.documentMarker === raw.marker ? prior.nodes : [], raw.nodes);
  observations.set(stateKey, state);
  const capture = visual === 'always' || (visual === 'auto' && (raw.nodes.length === 0 || raw.hasVisualSurface));
  const image = capture ? await cdp.captureScreenshot(tabId, { format: 'jpeg', quality: 70, fullPage: false }) : undefined;
  return {
    sessionId,
    tabId: String(tabId),
    revision: state.revision,
    documentId: state.documentId,
    url: tab.url ?? '',
    title: tab.title ?? '',
    focused: raw.nodes.find((node) => node.states.includes('focused'))?.ref,
    nodes: raw.nodes,
    changes,
    visual: image ? { mimeType: 'image/jpeg', data: image } : undefined,
  };
}

async function tabs(
  sessionId: string,
  input: Extract<BrowserActionInput, { action: 'tabs' }>,
  startedAt: number,
  timeoutMs: number,
): Promise<BrowserControlResult> {
  const session = await getOrCreateAutomationWindow(sessionId);
  if (input.operation === 'create') {
    const created = await addTabToAutomationGroup(input.url ?? 'about:blank', sessionId);
    session.activeTabId = created.tabId;
    if (input.url) await waitForTabLoad(created.tabId, timeoutMs);
  } else if (input.operation === 'activate') {
    const tabId = Number(input.tabId);
    if (!Number.isInteger(tabId) || !session.tabIds.includes(tabId)) return fail('TARGET_NOT_FOUND', `Tab ${input.tabId ?? ''} was not found.`);
    session.activeTabId = tabId;
    await chrome.tabs.update(tabId, { active: true });
  } else if (input.operation === 'close') {
    const tabId = Number(input.tabId);
    if (!Number.isInteger(tabId) || !session.tabIds.includes(tabId)) return fail('TARGET_NOT_FOUND', `Tab ${input.tabId ?? ''} was not found.`);
    await chrome.tabs.remove(tabId);
    session.tabIds = session.tabIds.filter((id) => id !== tabId);
    session.activeTabId = session.tabIds[0] ?? null;
  }
  const currentTabs = await chrome.tabs.query({ groupId: session.groupId });
  return {
    ok: true,
    receipt: {
      action: 'tabs', risk: 'read', durationMs: Date.now() - startedAt, verified: true,
      tabs: currentTabs.map((tab) => ({ id: String(tab.id), url: tab.url ?? '', title: tab.title ?? '', active: tab.id === session.activeTabId })),
    },
  };
}

async function wait(tabId: number, input: Extract<BrowserActionInput, { action: 'wait' }>, defaultTimeout: number): Promise<void> {
  const timeout = input.timeoutMs ?? defaultTimeout;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (input.condition === 'page_idle') {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return;
    } else if (input.condition === 'text') {
      const found = await cdp.evaluate(tabId, `document.body?.innerText.includes(${JSON.stringify(input.value ?? '')})`);
      if (found) return;
    } else if (input.ref) {
      const visible = await evaluateRef(tabId, input.ref, `(element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }`);
      if ((input.condition === 'visible' && visible) || (input.condition === 'hidden' && !visible)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${input.condition}`);
}

async function evaluateRef(tabId: number, ref: string, functionBody: string, value?: unknown): Promise<unknown> {
  const expression = `(() => {
    const matches = document.querySelectorAll('[data-xopc-ref="' + ${JSON.stringify(ref)} + '"]');
    if (matches.length !== 1) return null;
    const element = matches[0];
    return (${functionBody})(element, ${JSON.stringify(value)});
  })()`;
  return cdp.evaluate(tabId, expression);
}

async function pressKey(tabId: number, key: string): Promise<void> {
  await cdp.dispatchInput(tabId, 'dispatchKeyEvent', { type: 'keyDown', key });
  await cdp.dispatchInput(tabId, 'dispatchKeyEvent', { type: 'keyUp', key });
}

function verified(
  input: BrowserActionInput,
  observation: BrowserObservation,
  startedAt: number,
  risk: 'read' | 'draft',
): BrowserControlResult {
  const expectation = 'expect' in input ? input.expect : undefined;
  const pageText = observation.nodes.map((node) => `${node.name}\n${node.value ?? ''}`).join('\n');
  const failure = expectation?.urlIncludes && !observation.url.includes(expectation.urlIncludes)
    ? `URL does not include ${expectation.urlIncludes}`
    : expectation?.titleIncludes && !observation.title.includes(expectation.titleIncludes)
      ? `Title does not include ${expectation.titleIncludes}`
      : expectation?.textIncludes && !pageText.includes(expectation.textIncludes)
        ? `Page does not include ${expectation.textIncludes}`
        : null;
  return failure
    ? fail('EXPECTATION_FAILED', failure, observation)
    : success(input.action, risk, startedAt, observation);
}

function success(
  action: BrowserActionInput['action'],
  risk: 'read' | 'draft',
  startedAt: number,
  observation?: BrowserObservation,
): BrowserControlResult {
  return { ok: true, receipt: { action, risk, durationMs: Date.now() - startedAt, verified: true, observation } };
}

function fail(
  code: Extract<BrowserControlResult, { ok: false }>['error']['code'],
  message: string,
  observation?: BrowserObservation,
): BrowserControlResult {
  return { ok: false, error: { code, message, observation } };
}

function diff(previous: BrowserNode[], next: BrowserNode[]) {
  const before = new Map(previous.map((node) => [node.ref, node]));
  const after = new Map(next.map((node) => [node.ref, node]));
  return {
    added: next.filter((node) => !before.has(node.ref)),
    changed: next.filter((node) => before.has(node.ref) && JSON.stringify(before.get(node.ref)) !== JSON.stringify(node)),
    removed: previous.filter((node) => !after.has(node.ref)).map((node) => node.ref),
  };
}
