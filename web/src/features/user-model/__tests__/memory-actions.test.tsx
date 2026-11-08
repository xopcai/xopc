// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { MemoryActions } from '../memory-actions';

vi.mock('swr', () => ({ default: () => ({ data: { agents: [{ id: 'researcher', name: 'Researcher' }],
  projects: [{ id: 'atlas', name: 'Atlas' }] }, isLoading: false }) }));

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); change.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('lets the owner choose a real named agent and project without silently selecting main', async () => {
  await act(async () => root.render(<MemoryActions language="en" busy={false} statement="Use pnpm" scope={{ type: 'global' }}
    onEdit={() => {}} onDelete={() => {}} onScopeChange={change} />));
  const openScope = async () => {
    const trigger = container.querySelector('button')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(item => item.textContent?.includes('Where it applies'))!;
    expect(item).toBeDefined();
    await act(async () => item.click());
  };
  await openScope();
  expect(document.body.textContent).not.toContain('This assistant only');
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Assistant: Researcher'))!.click());
  expect(change).toHaveBeenLastCalledWith({ type: 'agent', id: 'researcher' });
  await openScope();
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('Project: Atlas'))!.click());
  expect(change).toHaveBeenLastCalledWith({ type: 'project', id: 'atlas' });
});
