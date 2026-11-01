import type { BrowserNode, BrowserObservation } from '@xopcai/browser-control-contract';
import type { RemoteBrowserInput } from '@xopcai/browser-control-contract/remote';

/** Bundled code only, executed in a private isolated world. No script or selector supplied by the Gateway is evaluated. */
export function desktopBrowserDom(namespace: string, command: { action: 'snapshot' } | RemoteBrowserInput): {
  nodes?: BrowserNode[]; revision?: number; documentId?: string; title?: string; url?: string; focused?: string;
  outputs?: Record<string, string>; error?: string;
} {
  type State = { revision: number; epoch: number; observedEpoch: number; documentId: string; refs: Map<string, HTMLElement>; nodes: BrowserNode[]; url: string; truncated: boolean; focused?: Element | null };
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  let state = root[namespace] as State | undefined;
  if (!state) {
    state = { revision: 0, epoch: 0, observedEpoch: -1, documentId: namespace + ':' + String(performance.timeOrigin), refs: new Map(), nodes: [], url: location.href, truncated: false };
    root[namespace] = state;
    const owned = state;
    new MutationObserver(() => { owned.epoch++; }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
    document.addEventListener('input', () => { owned.epoch++; }, true);
    document.addEventListener('change', () => { owned.epoch++; }, true);
    // Browser attachments/downloads have a separate authorization surface and are unavailable here.
    document.addEventListener('click', event => {
      const element = event.target instanceof Element ? event.target.closest('input[type=file],a[download]') : null;
      if (element) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  const visible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return element.isConnected && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const role = (element: HTMLElement) => element.getAttribute('role') || ({ a: 'link', button: 'button', textarea: 'textbox', select: 'combobox',
    summary: 'button', input: (element as HTMLInputElement).type === 'checkbox' ? 'checkbox' : (element as HTMLInputElement).type === 'radio' ? 'radio' : 'textbox' }[element.tagName.toLowerCase()] ?? 'generic');
  const name = (element: HTMLElement) => (element.getAttribute('aria-label') || element.getAttribute('title')
    || ('labels' in element ? [...((element as HTMLInputElement).labels ?? [])].map(label => label.textContent).join(' ') : '')
    || element.textContent || element.getAttribute('placeholder') || '').trim().slice(0, 240);
  if (command.action === 'snapshot') {
    const refs = new Map<string, HTMLElement>(), nodes: BrowserNode[] = [];
    let characters = 0; state.truncated = false;
    for (const element of document.querySelectorAll<HTMLElement>('a[href],button,input:not([type=hidden]),textarea,select,summary,[contenteditable=true],[role],[tabindex]')) {
      if (!visible(element) || element instanceof HTMLInputElement && ['file', 'password'].includes(element.type)) continue;
      const ref = `e${nodes.length + 1}`, rect = element.getBoundingClientRect();
      const states: string[] = [];
      if (document.activeElement === element) states.push('focused');
      if ('disabled' in element && element.disabled) states.push('disabled');
      if ('checked' in element && element.checked) states.push('checked');
      const item: BrowserNode = { ref, role: role(element), name: name(element), states,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      if (element instanceof HTMLAnchorElement) item.href = element.href.slice(0, 4096);
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) item.value = element.value.slice(0, 1024);
      characters += JSON.stringify(item).length;
      if (characters > 18000 || nodes.length >= 100) { state.truncated = true; break; }
      refs.set(ref, element); nodes.push(item);
    }
    state.refs = refs; state.nodes = nodes; state.revision++; state.observedEpoch = state.epoch; state.url = location.href; state.focused = document.activeElement;
    return { nodes, revision: state.revision, documentId: state.documentId, title: document.title.slice(0, 4096), url: location.href.slice(0, 4096),
      focused: nodes.find(node => node.states.includes('focused'))?.ref };
  }
  if (command.action !== 'wait' && state.observedEpoch !== state.epoch || state.url !== location.href) return { error: 'STALE_OBSERVATION' };
  if (command.action === 'resolve') {
    const target = command.semanticTarget;
    const matches = state.nodes.filter(node => node.role === target.role && (target.name === undefined || node.name === target.name)
      && (target.nameIncludes === undefined || node.name.includes(target.nameIncludes))
      && (target.testId === undefined || state!.refs.get(node.ref)?.getAttribute('data-testid') === target.testId)
      && (!target.scope || (() => {
        let parent = state!.refs.get(node.ref)?.parentElement;
        while (parent) { if (role(parent) === target.scope.role && name(parent) === target.scope.name) return true; parent = parent.parentElement; }
        return false;
      })()));
    if (matches.length !== 1 || state.truncated) return { error: 'TARGET_NOT_FOUND' };
    return { outputs: { ref: matches[0]!.ref } };
  }
  if (!('revision' in command) || command.revision !== state.revision || command.action !== 'wait' && state.observedEpoch !== state.epoch || state.url !== location.href) return { error: 'STALE_OBSERVATION' };
  const element = 'ref' in command && command.ref ? state.refs.get(command.ref) : undefined;
  if ('ref' in command && command.ref && command.action !== 'wait' && (!element || !visible(element))) return { error: 'TARGET_NOT_FOUND' };
  if (element && (element.getAttribute('aria-disabled') === 'true' || 'disabled' in element && element.disabled)) return { error: 'INVALID_INPUT' };
  switch (command.action) {
    case 'click': element!.click(); break;
    case 'fill': {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element instanceof HTMLInputElement && !['text', 'search', 'url', 'email', 'tel', 'number'].includes(element.type)) return { error: 'INVALID_INPUT' };
      const descriptor = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value');
      descriptor!.set!.call(element, command.value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
      if (command.submit) element.form?.requestSubmit(); break;
    }
    case 'select': {
      if (!(element instanceof HTMLSelectElement)) return { error: 'INVALID_INPUT' };
      element.value = command.value; element.dispatchEvent(new Event('change', { bubbles: true })); break;
    }
    case 'check': {
      if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type)) return { error: 'INVALID_INPUT' };
      if (element.checked !== command.checked) element.click(); break;
    }
    case 'scroll': (element ?? document.scrollingElement)?.scrollBy({ top: command.deltaY }); break;
    case 'press': {
      // Trusted Chromium keyboard dispatch is performed by Main after this same revision/ref validation.
      if (!element && document.activeElement !== state.focused) return { error: 'STALE_OBSERVATION' };
      const focused = element ?? document.activeElement;
      if (focused instanceof HTMLInputElement && ['file', 'password'].includes(focused.type)) return { error: 'INVALID_INPUT' };
      element?.focus(); return { outputs: { keyboardValidated: 'true' } };
    }
    case 'wait': {
      const satisfied = command.condition === 'page_idle' ? document.readyState === 'complete'
        : command.condition === 'text' ? Boolean(command.value && document.body?.innerText.includes(command.value))
          : command.condition === 'hidden' ? !element || !visible(element) : !!element && visible(element);
      return satisfied ? {} : { error: 'TIMEOUT' };
    }
    default: return { error: 'INVALID_INPUT' };
  }
  return {};
}

export function desktopBrowserObservation(sessionId: string, tabId: string, raw: ReturnType<typeof desktopBrowserDom>): BrowserObservation {
  if (!raw.nodes || !raw.documentId || !raw.revision || raw.url === undefined || raw.title === undefined) throw new Error('DESKTOP_BROWSER_OBSERVATION_INVALID');
  return { sessionId, tabId, revision: raw.revision, documentId: raw.documentId, title: raw.title, url: raw.url, nodes: raw.nodes,
    ...(raw.focused ? { focused: raw.focused } : {}), changes: { added: raw.nodes, changed: [], removed: [] } };
}
