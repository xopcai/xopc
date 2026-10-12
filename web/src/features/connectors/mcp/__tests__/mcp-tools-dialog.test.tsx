// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';

import { fetchMcpTools, type McpToolInfo } from '../mcp-config-api';
import { McpToolsDialog } from '../mcp-tools-dialog';

vi.mock('../mcp-config-api', () => ({ fetchMcpTools: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const t = messages('zh').mcpSettings;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const tools: McpToolInfo[] = [
  { name: 'mcp__docs__lookup', description: 'Search documentation', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'mcp__docs__write', description: 'Create a note', inputSchema: { type: 'object' }, exposure: 'hidden' },
];
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); });
async function render() { await act(async () => root.render(<McpToolsDialog serverId="docs" t={t} onClose={() => {}} />)); }
function button(label: string) { return [...document.querySelectorAll('button')].find(node => node.textContent === label)!; }

it('loads a skeleton then shows tools, schemas, filters and refreshes', async () => {
  let resolve!: (tools: McpToolInfo[]) => void;
  vi.mocked(fetchMcpTools).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await render();
  expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(t.toolsLoading);
  expect(button(t.refreshTools).disabled).toBe(true);
  await act(async () => resolve(tools));
  expect(document.body.textContent).toContain('mcp__docs__lookup');
  expect(document.body.textContent).toContain('hidden');
  expect(document.querySelector('pre')?.textContent).toContain('query');
  const input = document.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'documentation');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.querySelectorAll('article')).toHaveLength(1);
  vi.mocked(fetchMcpTools).mockResolvedValueOnce([]);
  await act(async () => button(t.refreshTools).click());
  expect(fetchMcpTools).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain(t.toolsEmpty);
});

it('shows connection errors and allows retry', async () => {
  vi.mocked(fetchMcpTools).mockRejectedValueOnce(new Error('needs sign-in'));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('needs sign-in');
  expect(document.body.textContent).toContain('xopc mcp login docs');
  vi.mocked(fetchMcpTools).mockResolvedValueOnce(tools);
  await act(async () => button(t.refreshTools).click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelectorAll('article')).toHaveLength(2);
});

it('aborts discovery on close', async () => {
  vi.mocked(fetchMcpTools).mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = vi.mocked(fetchMcpTools).mock.calls[0][1];
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
