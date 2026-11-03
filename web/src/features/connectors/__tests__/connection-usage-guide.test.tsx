// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { ConnectionUsageGuide } from '../components/connection-usage-guide';
import { fetchMcpDraftTools, fetchMcpTools } from '../mcp/mcp-config-api';
import { connectionUsagePath } from '../utils/connection-usage';

vi.mock('../mcp/mcp-config-api', () => ({ fetchMcpTools: vi.fn(), fetchMcpDraftTools: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ''; vi.resetAllMocks(); });
const target = { name: '团队资料', id: 'team-docs', kind: 'mcp' as const };
async function render(props: Partial<Parameters<typeof ConnectionUsageGuide>[0]> = {}) {
  useLocaleStore.setState({ language: 'zh' });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ConnectionUsageGuide target={target} {...props} /></MemoryRouter>));
}
it('offers a simple editable introduction without fetching tool recommendations', async () => {
  await render();
  expect(document.body.textContent).toContain('在对话中提到它');
  expect(document.body.textContent).not.toContain('推荐');
  expect(fetchMcpTools).not.toHaveBeenCalled();
  expect(fetchMcpDraftTools).not.toHaveBeenCalled();
  const params = new URL(document.querySelector('a')!.href).searchParams;
  expect(params.has('autoSend')).toBe(false);
  expect(params.get('draft')).toContain('我想了解怎么用「团队资料」');
  expect(params.get('draft')).toContain('先不用帮我操作');
});
it('previews an unsaved connection without offering chat before commit', async () => {
  await render({ preview: true });
  expect(document.body.textContent).toContain('保存并启用后');
  expect(document.querySelector('a')).toBeNull();
  expect(fetchMcpDraftTools).not.toHaveBeenCalled();
});
it('can leave the start action to the dialog footer', async () => {
  await render({ showAction: false });
  expect(document.body.textContent).toContain('在对话中使用');
  expect(document.querySelector('a')).toBeNull();
});
it.each(['plugin', 'connector', 'mcp'] as const)('builds localized plain-language introductions for %s', kind => {
  for (const zh of [true, false]) {
    const params = new URL(connectionUsagePath({ ...target, kind }, zh), 'http://localhost').searchParams;
    expect(params.get('draft')).toContain(target.name);
    expect(params.get('draft')).not.toMatch(/JSON|tools|skills|permissions|工具|技能|权限|"type"|team-docs/);
    expect(params.get('projectScope')).toBe('none');
    expect(params.has('autoSend')).toBe(false);
  }
});
