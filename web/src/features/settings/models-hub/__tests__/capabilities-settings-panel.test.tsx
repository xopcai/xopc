// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../connected-providers-grid', () => ({ useConnectedProviders: () => ({ cards: [], builtinRows: [], allModels: [], loading: false }), ConnectedProvidersGrid: () => <div data-testid="service-accounts" /> }));
vi.mock('../../settings-page-layout', () => ({ SettingsPageFrame: ({children}: any) => <div>{children}</div>, SettingsPageHeader: ({ actions }: any) => <header>{actions}</header> }));
vi.mock('../../voice-settings', () => ({ VoiceSettingsPanel: () => <div data-testid="voice-editor" /> }));
vi.mock('../capability-service-connections', () => ({ CapabilityServiceConnections: () => <div>connection</div> }));
vi.mock('../media-service-connections', () => ({ MediaServiceConnections: () => null }));
vi.mock('../model-uses-list', () => ({ ModelUsesList: ({ onChange, renderSettings, expandedUse }: any) => <div data-testid="capability-overview"><button onClick={() => onChange('transcription')}>Connect inline</button>{['chat', 'vision', 'image', 'transcription', 'speech', 'conversation', 'background'].map(use => <button key={use} data-use={use} onClick={() => onChange(use)}>{use}</button>)}{renderSettings && expandedUse ? renderSettings(expandedUse) : null}</div> }));
import { CapabilitiesSettingsPanel } from '../capabilities-settings-panel';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('mounts one voice editor when a legacy capability detail opens its connection', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={['/settings/capabilities/models?use=transcription']}><Routes><Route path="/settings/capabilities/:capability" element={<CapabilitiesSettingsPanel />} /></Routes></MemoryRouter>));
  expect(container.querySelectorAll('[data-testid="voice-editor"]')).toHaveLength(1);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Connect inline')!.click());
  expect(container.querySelectorAll('[data-testid="voice-editor"]')).toHaveLength(1);
});
it('leaves background document scrolling untouched when embedded', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const scroller = { scrollTop: 321 };
  const descriptor = Object.getOwnPropertyDescriptor(document, 'scrollingElement');
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: scroller });
  try {
    await act(async () => root.render(<MemoryRouter><CapabilitiesSettingsPanel inlineUse="speech" /></MemoryRouter>));
    expect(scroller.scrollTop).toBe(321);
  } finally {
    if (descriptor) Object.defineProperty(document, 'scrollingElement', descriptor); else Reflect.deleteProperty(document, 'scrollingElement');
  }
});


it.each(['chat', 'vision', 'image', 'transcription', 'speech', 'conversation', 'background'])('opens %s connections in the merged page after resolving a legacy service link', async use => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const events: unknown[] = [];
  const record = (event: Event) => events.push((event as CustomEvent).detail);
  window.addEventListener('open-capability-settings', record);
  const route = '/settings/capabilities/models?view=services&returnTo=%2Fchat%2Fdraft';
  function Location() { const location = useLocation(); return <output data-return-state={location.state?.returnTo}>{location.pathname + location.search}</output>; }
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: route.split('?')[0], search: '?' + route.split('?')[1], state: { returnTo: '/chat/origin' } }]}><Routes><Route path="/settings/capabilities/:capability" element={<><CapabilitiesSettingsPanel /><Location /></>} /></Routes></MemoryRouter>));
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-use]');
    expect(buttons).toHaveLength(7);
    const index = ['chat', 'vision', 'image', 'transcription', 'speech', 'conversation', 'background'].indexOf(use);
    await act(async () => buttons[index].click());
    expect(events).toEqual([{ use, view: 'services' }]);
    expect(container.querySelector('output')?.getAttribute('data-return-state')).toBe('/chat/origin');
    expect(container.querySelector('output')?.textContent).toBe('/settings/capabilities/models?returnTo=%2Fchat%2Fdraft');
    expect(container.querySelectorAll('[data-testid="capability-overview"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="service-accounts"]')).toHaveLength(1);
    expect(container.textContent).not.toContain('Connect by capability');
  } finally { window.removeEventListener('open-capability-settings', record); }
});

it('focuses service accounts on the same page without changing the route', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  function Location() { const location = useLocation(); return <output data-return-state={location.state?.returnTo}>{location.pathname + location.search}</output>; }
  await act(async () => root.render(<MemoryRouter initialEntries={['/settings/capabilities/models']}><Routes><Route path="/settings/capabilities/:capability" element={<><CapabilitiesSettingsPanel /><Location /></>} /></Routes></MemoryRouter>));
  const button = [...container.querySelectorAll('button')].find(button => /Service accounts|服务账户/.test(button.textContent ?? ''))!;
  await act(async () => button.click());
  expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('model-services-heading');
  expect(container.querySelector('output')?.textContent).toBe('/settings/capabilities/models');
});

it('preserves contextual legacy speech connection links and their return context', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={['/settings/capabilities/models?use=speech&view=services&from=voice&returnTo=%2Fchat%2Fdraft']}><Routes><Route path="/settings/capabilities/:capability" element={<CapabilitiesSettingsPanel />} /></Routes></MemoryRouter>));
  expect(container.textContent).toContain('connection');
  expect(container.querySelector('a[href*="use=speech"]')?.getAttribute('href')).toContain('from=voice&returnTo=%2Fchat%2Fdraft');
  expect(container.querySelector('[data-testid="capability-overview"]')).toBeNull();
});
