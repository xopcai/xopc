// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../connected-providers-grid', () => ({ useConnectedProviders: () => ({ cards: [], builtinRows: [], allModels: [], loading: false }), ConnectedProvidersGrid: () => <div data-testid="service-accounts" /> }));
vi.mock('../../settings-page-layout', () => ({ SettingsPageFrame: ({children}: any) => <div>{children}</div>, SettingsPageHeader: ({actions}: any) => <header>{actions}</header> }));
vi.mock('../../voice-settings', () => ({ VoiceSettingsPanel: () => <div data-testid="voice-editor" /> }));
vi.mock('../capability-service-connections', () => ({ CapabilityServiceConnections: () => <div data-testid="connection" /> }));
vi.mock('../media-service-connections', () => ({ MediaServiceConnections: () => null }));
vi.mock('../model-uses-list', () => ({ ModelUsesList: ({onChange}: any) => <div data-testid="capability-overview"><button onClick={() => onChange('transcription')}>Connect</button></div> }));
import { CapabilitiesSettingsPanel } from '../capabilities-settings-panel';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function Location() { const location=useLocation(); return <output>{location.pathname+location.search}</output>; }
const render = async (query = '', inlineUse?: 'speech') => {
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/settings/capabilities/models'+query]}><Routes><Route path="/settings/capabilities/:capability" element={<><CapabilitiesSettingsPanel inlineUse={inlineUse}/><Location/></>}/></Routes></MemoryRouter>);await new Promise(resolve=>setTimeout(resolve,20)); });
};
it('keeps a single overview and service list, and focuses accounts without navigating', async () => {
  await render();
  expect(container.querySelectorAll('[data-testid="capability-overview"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-testid="service-accounts"]')).toHaveLength(1);
  const button=[...container.querySelectorAll('button')].find(button=>/Service accounts|服务账户/.test(button.textContent??''))!;
  await act(async()=>button.click());
  expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('model-services-heading');
  expect(container.querySelector('output')?.textContent).toBe('/settings/capabilities/models');
});
it.each(['speech','transcription','conversation'])('opens the %s modal from the canonical link and consumes its command', async use => {
  const events: unknown[]=[];const record=(event:Event)=>events.push((event as CustomEvent).detail);window.addEventListener('open-capability-settings',record);
  try {
    await render(`?configure=${use}&tab=services&returnTo=%2Fpersonal`);
    await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
    expect(events).toEqual([{use,view:'services'}]);
    expect(container.querySelector('output')?.textContent).toBe('/settings/capabilities/models?returnTo=%2Fpersonal');
  } finally {window.removeEventListener('open-capability-settings',record);}
});
it('mounts one scoped editor without moving the background document scroll', async()=>{
  const scroller={scrollTop:321};const descriptor=Object.getOwnPropertyDescriptor(document,'scrollingElement');Object.defineProperty(document,'scrollingElement',{configurable:true,value:scroller});
  try {await render('', 'speech');expect(container.querySelectorAll('[data-testid="voice-editor"]')).toHaveLength(1);expect(scroller.scrollTop).toBe(321);}finally{if(descriptor)Object.defineProperty(document,'scrollingElement',descriptor);else Reflect.deleteProperty(document,'scrollingElement');}
});
