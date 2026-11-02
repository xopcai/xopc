// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ load: vi.fn(), patch: vi.fn(), mutate: vi.fn(), config: { model: 'test/model', actionApprovalMode: 'ask', configVersion: 7 } }));
vi.mock('swr', () => ({ default: () => ({ data: mocked.config, mutate: mocked.mutate, isLoading: false }) }));
vi.mock('@/features/chat/session/session-manager', () => ({ SessionManager: class { loadSessionAgentConfig = mocked.load; patchSessionAgentConfig = mocked.patch; } }));

import { ActionApprovalControl } from '../action-approval-control';
import { actionApprovalPreferenceForAgent } from '@xopcai/gateway-contract';
import { actionApprovalPreferenceScope, readNewSessionPreferences } from '@/features/chat/session/new-session-preferences';
import { useLocaleStore } from '@/stores/locale-store';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  useChatSessionStore.setState({ sessions: {} });
  mocked.config.actionApprovalMode = 'ask';
  localStorage.clear();
  vi.clearAllMocks();
  mocked.mutate.mockResolvedValue(undefined);
  mocked.load.mockResolvedValue(mocked.config);
  mocked.patch.mockResolvedValue({ ...mocked.config, actionApprovalMode: 'full', configVersion: 8 });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const click = async (element: HTMLElement) => act(async () => element.click());
it('offers exactly the two supported modes and saves with the authoritative version', async () => {
  await act(async () => root.render(<ActionApprovalControl conversationId="session" agentId="coder" disabled={false} />));
  await click(container.querySelector('button')!);
  const options = [...document.querySelectorAll('button')];
  expect(options.some(button => button.textContent === 'Ask for approval')).toBe(true);
  expect(options.some(button => button.textContent === 'Approve for me')).toBe(false);
  await click(options.find(button => button.textContent === 'Full access')!);
  expect(actionApprovalPreferenceForAgent(readNewSessionPreferences(), 'coder', actionApprovalPreferenceScope())).toBe('full');
  expect(mocked.patch).toHaveBeenCalledWith('session', { actionApprovalMode: 'full', configVersion: 7 });
  expect(mocked.mutate).toHaveBeenCalledWith(expect.objectContaining({ actionApprovalMode: 'full', configVersion: 8 }), false);
});
it('keeps the selector disabled while a run is active', async () => {
  await act(async () => root.render(<ActionApprovalControl conversationId="session" disabled />));
  expect(container.querySelector('button')?.disabled).toBe(true);
  expect(mocked.patch).not.toHaveBeenCalled();
});

it('does not replace the remembered mode when saving is rejected', async () => {
  mocked.patch.mockRejectedValueOnce(new Error('Task still running'));
  await act(async () => root.render(<ActionApprovalControl conversationId="session" agentId="coder" disabled={false} />));
  await click(container.querySelector('button')!);
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Full access')!);
  expect(actionApprovalPreferenceForAgent(readNewSessionPreferences(), 'coder', actionApprovalPreferenceScope())).toBeUndefined();
});

it('does not change the next-chat preference when viewing an older full-access chat', async () => {
  mocked.config.actionApprovalMode = 'full';
  await act(async () => root.render(<ActionApprovalControl conversationId="session" agentId="coder" disabled={false} />));
  expect(actionApprovalPreferenceForAgent(readNewSessionPreferences(), 'coder', actionApprovalPreferenceScope())).toBeUndefined();
});
