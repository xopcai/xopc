import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

import { desktopBrowserDom } from '../desktop/browser-dom.js';

function fixture(html = '<button id="counter" aria-label="Increment">0</button><input aria-label="Draft"><input type="password" value="secret"><input type="file">') {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0, toJSON() {} });
  const run = (command: Parameters<typeof desktopBrowserDom>[1]) => dom.window.eval(`(${desktopBrowserDom.toString()})('private_fixture',${JSON.stringify(command)})`) as ReturnType<typeof desktopBrowserDom>;
  return { dom, run };
}
it('keeps refs private, excludes password/file fields and performs one exact observed DOM action', async () => {
  const f = fixture(); let clicks = 0;
  f.dom.window.document.getElementById('counter')!.addEventListener('click', () => clicks++);
  const observed = f.run({ action: 'snapshot' });
  expect(observed.nodes).toHaveLength(2); expect(JSON.stringify(observed)).not.toContain('secret');
  expect(f.dom.window.document.querySelector('[data-xopc-ref]')).toBeNull();
  expect(f.run({ action: 'resolve', semanticTarget: { role: 'button', name: 'Increment' } })).toEqual({ outputs: { ref: 'e1' } });
  expect(f.run({ action: 'click', revision: observed.revision!, ref: 'e1' })).toEqual({}); expect(clicks).toBe(1);
  expect(f.run({ action: 'click', revision: 999, ref: 'e1' })).toEqual({ error: 'STALE_OBSERVATION' }); expect(clicks).toBe(1);
  f.dom.window.close();
});
it('rejects a DOM mutation after observation and cannot resolve an ambiguous or truncated target', async () => {
  const f = fixture(); const observed = f.run({ action: 'snapshot' });
  f.dom.window.document.getElementById('counter')!.setAttribute('aria-label', 'Changed'); await Promise.resolve();
  expect(f.run({ action: 'click', revision: observed.revision!, ref: 'e1' })).toEqual({ error: 'STALE_OBSERVATION' });
  expect(f.run({ action: 'resolve', semanticTarget: { role: 'button' } })).toEqual({ error: 'STALE_OBSERVATION' });
  f.dom.window.close();
  const large = fixture('<button aria-label="Unique">Unique</button>' + '<button>Other</button>'.repeat(110));
  expect(large.run({ action: 'snapshot' }).nodes).toHaveLength(100);
  expect(large.run({ action: 'resolve', semanticTarget: { role: 'button', name: 'Unique' } })).toEqual({ error: 'TARGET_NOT_FOUND' });
  large.dom.window.close();
});
it('changes a typed draft through native DOM setters and rejects password/file substitution', () => {
  const f = fixture(); const state = f.run({ action: 'snapshot' });
  expect(f.run({ action: 'fill', revision: state.revision!, ref: 'e2', value: 'reviewed draft' })).toEqual({});
  expect(f.dom.window.document.querySelector('input')!.value).toBe('reviewed draft');
  const current = f.run({ action: 'snapshot' });
  expect(f.run({ action: 'fill', revision: current.revision!, ref: 'e999', value: 'bad' })).toEqual({ error: 'TARGET_NOT_FOUND' });
  f.dom.window.close();
});
it('rejects changed focus and sensitive focused fields before Main can send any keyboard input', () => {
  const f = fixture(), observed = f.run({ action: 'snapshot' });
  f.dom.window.document.querySelector('input')!.focus();
  expect(f.run({ action: 'press', revision: observed.revision!, key: 'Enter' })).toEqual({ error: 'STALE_OBSERVATION' });
  f.dom.window.document.querySelector<HTMLInputElement>('input[type=password]')!.focus();
  const current = f.run({ action: 'snapshot' });
  expect(f.run({ action: 'press', revision: current.revision!, key: 'a' })).toEqual({ error: 'INVALID_INPUT' });
  f.dom.window.close();
});
