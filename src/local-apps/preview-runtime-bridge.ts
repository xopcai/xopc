import { createHash } from 'node:crypto';

import type { LocalAppAcceptanceConfig } from './acceptance.js';
import { encodeLocalAppAcceptanceConfig } from './acceptance.js';

export const LOCAL_APP_RUNTIME_BRIDGE_SCRIPT = `(() => {
  let hostPort = null;
  const pending = [];
  const send = (type, detail) => {
    const message = { source: 'xopc-local-app-preview', version: 1, type, detail };
    if (hostPort) hostPort.postMessage(message);
    else pending.push(message);
  };
  const connect = (event) => {
    const message = event.data;
    if (event.source !== parent || message?.source !== 'xopc-local-app-host' || message?.version !== 1 || message?.type !== 'connect' || !event.ports[0]) return;
    event.stopImmediatePropagation();
    removeEventListener('message', connect, true);
    hostPort = event.ports[0];
    hostPort.start();
    for (const queued of pending.splice(0)) hostPort.postMessage(queued);
  };
  addEventListener('message', connect, true);
  const text = (value) => String(value ?? '').slice(0, 500);
  let runtimeFailure = '';
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const accessibleName = (element) => {
    const labelledBy = text(element.getAttribute('aria-labelledby'));
    const labelledText = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    return text(element.getAttribute('aria-label') || labelledText || element.labels?.[0]?.textContent || element.textContent || element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') || element.getAttribute('name')).trim();
  };
  const target = (id) => Array.from(document.querySelectorAll('[data-xopc-test-id]'))
    .find((element) => element.getAttribute('data-xopc-test-id') === id);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
  const readCriteria = () => {
    const encoded = document.querySelector('meta[name="xopc-local-app-acceptance"]')?.content;
    if (!encoded) return { schemaVersion: 1, scenarios: [] };
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  addEventListener('error', (event) => {
    runtimeFailure = text(event.message || 'A preview resource failed to load');
    send('error', {
      kind: 'script_error',
      message: runtimeFailure,
      filename: text(event.filename),
      line: Number(event.lineno) || undefined,
      column: Number(event.colno) || undefined,
    });
  }, true);
  addEventListener('unhandledrejection', (event) => {
    runtimeFailure = text(event.reason instanceof Error ? event.reason.message : event.reason);
    send('error', { kind: 'unhandled_rejection', message: runtimeFailure });
  });
  const runAcceptance = () => {
    const checks = [];
    const bodyReady = Boolean(document.body);
    checks.push({ id: 'document', status: bodyReady ? 'passed' : 'failed', message: bodyReady ? 'Preview document loaded' : 'Preview document has no body' });
    const contentNodes = bodyReady ? Array.from(document.body.querySelectorAll('*')).slice(0, 300) : [];
    const hasVisibleContent = contentNodes.some((element) => visible(element) && (text(element.textContent).trim() || /^(IMG|SVG|CANVAS|VIDEO)$/.test(element.tagName)));
    checks.push({ id: 'content', status: hasVisibleContent ? 'passed' : 'failed', message: hasVisibleContent ? 'Visible content rendered' : 'No visible content was rendered' });
    const controls = bodyReady ? Array.from(document.body.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]')).filter((element) => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true') : [];
    const unnamed = controls.filter((element) => !accessibleName(element));
    let interactionStatus = controls.length ? 'passed' : 'skipped';
    let interactionMessage = controls.length ? controls.length + ' interactive control(s) are discoverable' : 'No interactive controls to exercise';
    if (unnamed.length) {
      interactionStatus = 'failed';
      interactionMessage = unnamed.length + ' interactive control(s) need an accessible name';
    } else if (controls.length) {
      const previous = document.activeElement;
      controls[0].focus({ preventScroll: true });
      if (document.activeElement !== controls[0]) {
        interactionStatus = 'failed';
        interactionMessage = 'The first interactive control could not receive focus';
      }
      if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      else controls[0].blur();
    }
    checks.push({ id: 'interaction', status: interactionStatus, message: interactionMessage });
    send('acceptance', {
      status: checks.some((check) => check.status === 'failed') ? 'failed' : 'passed',
      checks,
      interactiveCount: controls.length,
    });
  };
  const runCriteria = async () => {
    const params = new URLSearchParams(location.search);
    if (params.get('xopcAcceptance') !== '1') return;
    let config;
    try {
      config = readCriteria();
    } catch (error) {
      send('criteria', { status: 'failed', scenarioCount: 0, scenarios: [{ id: 'config', name: 'Acceptance config', status: 'failed', message: text(error instanceof Error ? error.message : error) }] });
      return;
    }
    const requestedScenario = params.get('xopcScenario');
    const selectedScenarios = requestedScenario
      ? (config.scenarios || []).filter((scenario) => scenario.id === requestedScenario)
      : config.scenarios || [];
    if (requestedScenario && !selectedScenarios.length) {
      send('criteria', { status: 'failed', scenarioCount: 1, scenarios: [{ id: requestedScenario, name: requestedScenario, status: 'failed', message: 'Requested scenario was not found' }] });
      return;
    }
    const scenarios = [];
    for (const scenario of selectedScenarios) {
      let failure = '';
      for (let index = 0; index < scenario.steps.length; index += 1) {
        const step = scenario.steps[index];
        try {
          if (step.action === 'click') {
            const element = target(step.target);
            if (!(element instanceof HTMLElement)) throw new Error('Target "' + step.target + '" was not found');
            if ('disabled' in element && element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('Target "' + step.target + '" is disabled');
            element.click();
            await pause();
          } else if (step.action === 'fill') {
            const element = target(step.target);
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Target "' + step.target + '" cannot be filled');
            const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (setter) setter.call(element, step.value);
            else element.value = step.value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            await pause();
          } else if (step.assert === 'text_visible') {
            const found = Array.from(document.body.querySelectorAll('*')).some((element) => visible(element) && text(element.textContent).includes(step.text));
            if (!found) throw new Error('Visible text was not found: "' + step.text + '"');
          } else if (step.assert === 'element_exists') {
            if (!target(step.target)) throw new Error('Target "' + step.target + '" was not found');
          } else if (step.assert === 'value_equals') {
            const element = target(step.target);
            if (!element || !('value' in element) || element.value !== step.value) throw new Error('Target "' + step.target + '" does not have the expected value');
          }
          if (runtimeFailure) throw new Error(runtimeFailure);
        } catch (error) {
          failure = 'Step ' + (index + 1) + ': ' + text(error instanceof Error ? error.message : error);
          break;
        }
      }
      scenarios.push({ id: scenario.id, name: scenario.name, status: failure ? 'failed' : 'passed', message: failure || 'Scenario passed' });
    }
    send('criteria', {
      status: scenarios.some((scenario) => scenario.status === 'failed') ? 'failed' : 'passed',
      scenarioCount: scenarios.length,
      scenarios,
    });
  };
  const loaded = () => {
    send('ready', { readyState: document.readyState });
    const run = () => { runAcceptance(); void runCriteria(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
    else setTimeout(run, 0);
  };
  if (document.readyState === 'complete') queueMicrotask(loaded);
  else addEventListener('load', loaded, { once: true });
})();`;

export const LOCAL_APP_RUNTIME_BRIDGE_HASH = createHash('sha256')
  .update(LOCAL_APP_RUNTIME_BRIDGE_SCRIPT)
  .digest('base64');

export function injectLocalAppRuntimeBridge(
  html: string,
  acceptance?: LocalAppAcceptanceConfig,
): string {
  const meta = acceptance
    ? `<meta name="xopc-local-app-acceptance" content="${encodeLocalAppAcceptanceConfig(acceptance)}">`
    : '';
  const script = `<script data-xopc-runtime-bridge>${LOCAL_APP_RUNTIME_BRIDGE_SCRIPT}</script>`;
  const additions = [meta, script].filter(Boolean).join('\n');
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${additions}`);
  }
  return `${additions}\n${html}`;
}
