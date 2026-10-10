export interface BrowserSemanticTarget {
  role: string;
  name?: string;
  nameIncludes?: string;
  testId?: string;
  scope?: { role: string; name: string };
}

export interface BrowserRecordingEvent {
  id: string;
  seq: number;
  documentId: string;
  sourceSeq: number;
  url: string;
  action: 'navigate' | 'click' | 'fill' | 'select' | 'check' | 'press' | 'checkpoint' | 'unsupported';
  target?: BrowserSemanticTarget;
  value?: string;
  checked?: boolean;
  key?: string;
}

export interface BrowserRecording {
  id: string;
  state: 'recording' | 'paused' | 'stopped' | 'interrupted';
  tabId: number;
  gatewayId: string;
  deviceId: string;
  generation: number;
  createdAtMs: number;
  events: BrowserRecordingEvent[];
  automationId?: string;
  error?: string;
}

/** Runs in the page. Keep all helpers inside this function for serialization. */
export async function browserDom(input: {
  operation: 'resolve' | 'record' | 'stop';
  target?: BrowserSemanticTarget;
  recordingId?: string;
  generation?: number;
}): Promise<any> {
  const root = globalThis as any;
  const doc = root.document;
  const normalize = (value: string) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
  const sensitive = (element: any) => element.type === 'password' || element.type === 'file'
    || /cc-|one-time-code|transaction-|password|token|secret|otp|cvv|cvc|card.?number|验证码|密码|银行卡|卡号/i.test([
      element.autocomplete, element.name, element.id, element.getAttribute('aria-label'), name(element),
    ].join(' '));
  const role = (element: any): string => element.getAttribute('role') || ({
    A: 'link', BUTTON: 'button', SUMMARY: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    FORM: 'form', FIELDSET: 'group', SECTION: 'region',
  } as Record<string, string>)[element.tagName]
    || (element.tagName === 'INPUT' ? element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio'
      : ['submit', 'button', 'reset'].includes(element.type) ? 'button' : 'textbox' : 'text');
  const name = (element: any): string => normalize(
    (element.getAttribute('aria-labelledby') || '').split(/\s+/).map((id: string) => doc.getElementById(id)?.textContent || '').join(' ')
    || element.getAttribute('aria-label') || element.labels?.[0]?.textContent
    || (element.tagName === 'FIELDSET' ? element.querySelector('legend')?.textContent : '')
    || element.getAttribute('alt') || element.getAttribute('placeholder')
    || (['submit', 'button', 'reset'].includes(element.type) ? element.value : '')
    || element.innerText || element.getAttribute('title') || '',
  );
  const describe = (element: any): BrowserSemanticTarget => {
    const container = element.parentElement?.closest('form,fieldset,section,[role="region"],[role="group"],[role="dialog"]');
    return {
      role: role(element), name: name(element),
      ...(element.getAttribute('data-testid') ? { testId: element.getAttribute('data-testid') } : {}),
      ...(container && name(container) ? { scope: { role: role(container), name: name(container) } } : {}),
    };
  };
  const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,[role],[data-testid],label,p,span,h1,h2,h3,td,output';
  if (input.operation === 'resolve') {
    const target = input.target!;
    const matches = Array.from(doc.querySelectorAll(selector)).filter((element: any) => {
      const rect = element.getBoundingClientRect();
      const style = root.getComputedStyle(element);
      if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') return false;
      const descriptor = describe(element);
      return descriptor.role === target.role
        && (!target.name || descriptor.name === target.name)
        && (!target.nameIncludes || descriptor.name?.includes(target.nameIncludes))
        && (!target.testId || descriptor.testId === target.testId)
        && (!target.scope || (descriptor.scope?.role === target.scope.role && descriptor.scope?.name === target.scope.name));
    }) as any[];
    if (matches.length !== 1) return { matches: matches.length };
    const element = matches[0];
    const ref = `xopc-e${++root.__xopcRefCounter || (root.__xopcRefCounter = 1)}`;
    element.setAttribute('data-xopc-ref', ref);
    return { matches: 1, node: {
      ref, role: role(element), name: name(element),
      value: !sensitive(element) && 'value' in element ? String(element.value).slice(0, 4096) : undefined,
      description: !sensitive(element) ? normalize(element.textContent) : undefined,
      href: element.tagName === 'A' ? element.href : undefined,
      states: [sensitive(element) ? 'sensitive' : '', element.disabled ? 'disabled' : '', element.checked ? 'checked' : '', ['BUTTON', 'INPUT'].includes(element.tagName) && element.type === 'submit' ? 'submit' : ''].filter(Boolean),
    } };
  }
  const prior = root.__xopcRecorder;
  if (input.operation === 'record' && prior?.recordingId === input.recordingId && prior?.generation === input.generation) return { recording: true };
  if (prior) {
    await prior.stop();
    delete root.__xopcRecorder;
  }
  if (input.operation === 'stop') return { stopped: true };
  let sourceSeq = 0;
  const pending = new Set<Promise<any>>();
  const dirty = new Set<any>();
  const lastValues = new WeakMap<object, string>();
  const listeners: [string, (event: any) => void][] = [];
  const cleanUrl = () => {
    const url = new URL(root.location.href);
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|key|code/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  };
  const documentId = `${root.performance.timeOrigin}:${input.generation}`;
  let failed = false;
  let ended = false;
  let enterTarget: any;
  let enterAt = 0;
  const emit = (event: any) => {
    const task = root.chrome.runtime.sendMessage({ type: 'browser/recording-event', recordingId: input.recordingId,
      generation: input.generation, event: { ...event, id: root.crypto.randomUUID(), sourceSeq: ++sourceSeq, documentId, url: cleanUrl() } })
      .then((ack: any) => { if (!ack?.ok) failed = true; }).catch(() => { failed = true; });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const flush = (element: any) => {
    if (!dirty.delete(element) || sensitive(element)) return;
    const value = String(element.value || '').slice(0, 4096);
    if (lastValues.get(element) === value) return;
    lastValues.set(element, value);
    emit({ action: element.tagName === 'SELECT' ? 'select' : 'fill', target: describe(element), value });
  };
  const listen = (type: string, handler: (event: any) => void) => {
    listeners.push([type, handler]); (type === 'pagehide' ? root : doc).addEventListener(type, handler, true);
  };
  listen('input', (event) => { if (event.isTrusted && !sensitive(event.target) && !['checkbox', 'radio'].includes(event.target.type) && 'value' in event.target) dirty.add(event.target); });
  listen('dragstart', (event) => { if (event.isTrusted) emit({ action: 'unsupported', value: 'Drag actions are not supported by the recorder.' }); });
  listen('change', (event) => {
    if (!event.isTrusted || sensitive(event.target)) return;
    if (['checkbox', 'radio'].includes(event.target.type)) emit({ action: 'check', target: describe(event.target), checked: !!event.target.checked });
    else { dirty.add(event.target); flush(event.target); }
  });
  listen('focusout', (event) => flush(event.target));
  listen('click', (event) => {
    if (!event.isTrusted) return;
    for (const element of dirty) flush(element);
    const element = event.target.closest('a[href],button,summary,[role="button"],input[type="submit"],input[type="button"]');
    if (element && event.detail === 0 && Date.now() - enterAt < 500
      && (element === enterTarget || element.form && element.form === enterTarget?.form)) return;
    if (element && !sensitive(element)) emit({ action: 'click', target: describe(element) });
    else if (event.target.closest('canvas,[contenteditable="true"],input[type="file"]')) emit({ action: 'unsupported', value: 'Canvas, rich text and file actions require an assistant to complete the workflow.' });
  });
  listen('pagehide', () => {
    for (const element of dirty) flush(element);
    emit({ action: 'checkpoint' }); ended = true;
    for (const [type, handler] of listeners) (type === 'pagehide' ? root : doc).removeEventListener(type, handler, true);
  });
  listen('keydown', (event) => {
    if (!event.isTrusted || event.isComposing || sensitive(event.target) || !['Enter', 'Escape'].includes(event.key)) return;
    flush(event.target);
    if (event.key === 'Enter') { enterTarget = event.target; enterAt = Date.now(); }
    emit({ action: 'press', target: describe(event.target), key: event.key });
  });
  root.__xopcRecorder = { recordingId: input.recordingId, generation: input.generation, stop: async () => {
    for (const [type, handler] of listeners) (type === 'pagehide' ? root : doc).removeEventListener(type, handler, true);
    for (const element of dirty) flush(element);
    if (!ended) { emit({ action: 'checkpoint' }); ended = true; }
    await Promise.all([...pending]);
    if (failed) throw new Error('Recording events could not be saved.');
  } };
  emit({ action: 'navigate' });
  return { recording: true, documentId };
}
