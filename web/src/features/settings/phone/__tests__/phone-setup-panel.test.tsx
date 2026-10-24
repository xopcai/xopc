// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ setup: null as Record<string, any> | null, requests: [] as Record<string, unknown>[] }));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn(async (_url: unknown, init: RequestInit) => {
  const input = JSON.parse(String(init.body)); fixture.requests.push(input);
  if (input.action === 'inspect') return { payload: { setup: fixture.setup } };
  if (input.action === 'begin_verification') fixture.setup = { ...fixture.setup, state: 'verifying', attempt: { released: false } };
  if (input.action === 'release') fixture.setup = { ...fixture.setup, state: 'needs_attention', attempt: { released: true } };
  return { payload: fixture.setup };
}) }));
vi.mock('@/features/settings/runtime-tools/phone-dependencies-card', () => ({ PhoneDependenciesCard: ({ cloudOnly }: { cloudOnly: boolean }) => <div>{cloudOnly ? 'cloud-dependencies' : 'local-dependencies'}</div> }));
vi.mock('@/components/ui/popover-select', () => ({ PopoverSelect: ({ value, onChange, options, disabled }: any) => <select disabled={disabled} value={value} onChange={e => onChange(e.target.value)}><option value="" />{options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
import { PhoneSetupPanel } from '../phone-setup-panel';
import { useLocaleStore } from '@/stores/locale-store';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const onContinue = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useLocaleStore.setState({ language: 'en' }); fixture.requests = []; onContinue.mockReset();
  fixture.setup = { id: 'setup', conversationId: 'conversation', agentId: 'main', revision: 1, state: 'configuring', source: 'local', stale: false,
    readiness: { enabled: true, toolAllowed: true, model: { ref: 'real/phone', supported: true, configured: true }, devices: [{ id: 'one', name: 'Phone', source: 'local', enabled: true, settingsAllowed: true }] },
    checks: { configured: true, read: false, operated: false, verified: false, released: false }, settingsPath: '/settings/phone-use?conversationId=conversation' };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(disabled = false) { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><PhoneSetupPanel conversationId="conversation" onContinue={onContinue} disabled={disabled} /></MemoryRouter></SWRConfig>)); }
const button = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text)!;
it('requires an explicit phone and discloses screenshots and real model costs before the scoped test', async () => {
  await render(); expect(button('Approve and start safe test').disabled).toBe(true);
  expect(container.textContent).toContain('may incur model charges'); expect(container.textContent).toContain('Phone and chat models are separate');
  await act(async () => { const select = container.querySelector('select')!; select.value = 'one'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Approve and start safe test').click());
  expect(fixture.requests).toContainEqual(expect.objectContaining({ action: 'begin_verification', deviceId: 'one', expectedRevision: 1 }));
  expect(onContinue).toHaveBeenCalledWith(expect.stringContaining('phone_setup get'));
});
it('guides cloud purchase without asking for a key or forcing local ADB installation', async () => {
  fixture.setup!.source = 'aliyun'; await render();
  expect(container.textContent).toContain('No local ADB needed'); expect(container.textContent).toContain('cloud-dependencies');
  expect(container.querySelector('input[type=password]')).toBeNull(); expect(container.textContent).toContain('does not stop cloud charges');
  expect(container.querySelector('a[href*="help.aliyun.com"]')).not.toBeNull();
});
it('keeps owner cleanup available while the model is busy or unable to continue', async () => {
  fixture.setup!.state = 'verifying'; fixture.setup!.attempt = { released: false }; await render(true);
  expect(button('Release test phone').disabled).toBe(false);
  await act(async () => button('Release test phone').click());
  expect(fixture.requests).toContainEqual(expect.objectContaining({ action: 'release' }));
});

it('restores the pinned test phone after a page reload and prevents changing it during verification', async () => {
  fixture.setup!.state = 'verifying'; fixture.setup!.attempt = { deviceId: 'one', released: false }; await render();
  expect(container.querySelector('select')!.value).toBe('one');
  expect(container.querySelector('select')!.disabled).toBe(true);
  expect(button('Release test phone').disabled).toBe(false);
});

it('explains exhausted model quota without asking to reinstall or reauthorize the phone', async () => {
  fixture.setup!.state = 'needs_attention'; fixture.setup!.error = 'PHONE_MODEL_QUOTA_EXHAUSTED';
  fixture.setup!.attempt = { deviceId: 'one', released: true };
  await render();
  expect(container.querySelector('[role=alert]')!.textContent).toContain('Phone model free quota is exhausted');
  expect(container.querySelector('[role=alert]')!.textContent).toContain('No ADB reinstall or device reauthorization is needed');
  expect(fixture.requests.filter(request => request.action !== 'inspect')).toHaveLength(0);
});
