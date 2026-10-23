// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ configured: true }));
vi.mock('@/components/ui/popover-select', () => ({
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  SelectOption: (props: React.OptionHTMLAttributes<HTMLOptionElement>) => <option {...props} />,
}));
vi.mock('@/features/settings/providers-api', () => ({
  fetchProviderMetaList: async () => [{ id: 'phone-provider', name: 'My provider' }],
  patchProviderApiKeys: vi.fn(),
}));
vi.mock('../phone-api', () => ({
  fetchPhoneModels: async () => ({ models: [
    { id: 'phone-provider/autoglm-phone', name: 'AutoGLM Phone', configured: fixture.configured, mock: false },
    { id: 'phone-mock/settings-about', name: 'Mock', configured: true, mock: true },
  ] }),
}));
import { PhoneModelConnection } from '../phone-model-connection';
import { patchProviderApiKeys } from '@/features/settings/providers-api';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onSave = vi.fn(async (_ref: string) => {});
beforeEach(() => { vi.clearAllMocks(); fixture.configured = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(value = 'phone-mock/settings-about') { await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><PhoneModelConnection value={value} zh disabled={false} onSave={onSave} /></MemoryRouter></SWRConfig>)); }
async function choose(value: string) { await act(async () => { const select = container.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
const saveButton = () => [...container.querySelectorAll('button')].find(button => button.textContent === '保存')!;

it('offers one model picker, connection status and the central management link', async () => {
  await render('phone-provider/autoglm-phone');
  expect(container.querySelectorAll('select')).toHaveLength(1);
  expect(container.querySelector('input')).toBeNull();
  expect(container.textContent).toContain('服务商：My provider · 凭据已配置');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/capabilities/models');
  expect(container.textContent).not.toContain('动作协议');
});
it('saves only the chosen phone route without modifying shared credentials', async () => {
  await render(); await choose('phone-provider/autoglm-phone');
  await act(async () => saveButton().click());
  expect(onSave).toHaveBeenCalledWith('phone-provider/autoglm-phone');
  expect(patchProviderApiKeys).not.toHaveBeenCalled();
  expect(container.textContent).toContain('手机模型已保存');
});
it('directs unconfigured models to central management instead of accepting a new key here', async () => {
  fixture.configured = false; await render(); await choose('phone-provider/autoglm-phone');
  expect(container.textContent).toContain('请先配置凭据');
  expect(saveButton().disabled).toBe(true);
  expect(container.querySelector('input')).toBeNull(); expect(onSave).not.toHaveBeenCalled();
});
it('keeps unavailable stored models visible but prevents saving them', async () => {
  await render('removed/model');
  expect(container.textContent).toContain('当前模型不可用');
  expect(saveButton().disabled).toBe(true);
});
