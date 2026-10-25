// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/stores/locale-store';
import { ModelPickerList } from '../model-selector';

const models = [
  { id: 'cloud/alpha', name: 'Alpha', provider: 'cloud' },
  { id: 'bailian/beta', name: 'Beta', provider: 'bailian' },
  { id: 'cloud/beta', name: 'Beta', provider: 'cloud' },
];
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const change = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({language:'en'}); change.mockClear();
  container=document.createElement('div'); document.body.append(container); root=createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = (groupByProvider=true) => act(async()=>root.render(<ModelPickerList models={models} value="cloud/beta" groupByProvider={groupByProvider} showSearch searchPlaceholder="Search" noMatches="No matches" onChange={change}/>));
const search = (value:string) => act(async()=>{const input=container.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
const groups = () => [...container.querySelectorAll('[role="group"]')].map(group=>group.getAttribute('aria-label'));
it('collects interleaved models under one provider while preserving provider and model order',async()=>{
  await render();
  expect(groups()).toEqual(['cloud','bailian']);
  expect([...container.querySelectorAll('[aria-label="cloud"] button')].map(button=>button.getAttribute('title'))).toEqual(['cloud/alpha','cloud/beta']);
  expect(container.querySelector('[title="cloud/beta"]')?.getAttribute('aria-pressed')).toBe('true');
});
it('filters by model name, provider and ID without leaving empty groups',async()=>{
  await render(); await search('Beta');expect(groups()).toEqual(['cloud','bailian']);
  await search('cloud');expect(groups()).toEqual(['cloud']);expect(container.querySelectorAll('button')).toHaveLength(2);
  await search('bailian/beta');expect(groups()).toEqual(['bailian']);
  await search('missing');expect(groups()).toEqual([]);expect(container.textContent).toContain('No matches');
});
it('selects the exact model ID even when names match across providers',async()=>{
  await render();await act(async()=>container.querySelector<HTMLButtonElement>('[title="bailian/beta"]')!.click());
  expect(change).toHaveBeenCalledExactlyOnceWith('bailian/beta');
});
it('reveals the selected option on opening without changing the model',async()=>{
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    await render();
    expect(scroll.mock.contexts).toContain(container.querySelector('[title="cloud/beta"]'));
    expect(change).not.toHaveBeenCalled();
  } finally {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
it('keeps form selectors flat unless provider grouping is requested',async()=>{
  await render(false);expect(groups()).toEqual([]);expect(container.querySelector('[title="cloud/alpha"]')?.textContent).toBe('Alphacloud');
});
