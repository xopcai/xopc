// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../phone-live-api', async original => ({ ...await original<typeof import('../phone-live-api')>(), controlPhone: vi.fn(), useConversationPhone: vi.fn() }));
import { PhoneAssistanceCard } from '../phone-assistance-card';
import { controlPhone, useConversationPhone, type PhoneLiveState } from '../phone-live-api';
import { usePhoneWorkspaceStore } from '../phone-workspace-store';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const state: PhoneLiveState = { report: { assistanceId: 'wait', sessionId: 'phone', deviceName: 'Phone', agentId: 'main',
  modelRef: 'test/phone', status: 'needs_user', mode: 'control', controlOwner: 'none', controlEpoch: 2,
  actions: 0, modelRequests: 1, updatedAt: 1, message: '请在手机上完成登录' }, ownControl: false, frame: null };
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.clearAllMocks(); usePhoneWorkspaceStore.setState({ open: false, selected: null, controlConversationId: null }); });
async function mount() {
  useLocaleStore.setState({ language: 'zh' });
  const mutate = vi.fn();
  vi.mocked(useConversationPhone).mockReturnValue({ data: state, mutate } as unknown as ReturnType<typeof useConversationPhone>);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PhoneAssistanceCard conversationId="chat" />));
  return mutate;
}
function button(text: string) { return [...container.querySelectorAll('button')].find(value => value.textContent === text)!; }

it('opens the phone and acquires manual control in one action, suppressing double clicks', async () => {
  const mutate = await mount();
  let complete!: (value: PhoneLiveState) => void;
  vi.mocked(controlPhone).mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }));
  await act(async () => { button('接管手机').click(); button('接管手机').click(); });
  expect(controlPhone).toHaveBeenCalledOnce();
  expect(controlPhone).toHaveBeenCalledWith('chat', state, 'takeover');
  const acquired: PhoneLiveState = { ...state, ownControl: true, report: { ...state.report, status: 'paused', controlOwner: 'human', controlEpoch: 3 } };
  await act(async () => complete(acquired));
  expect(mutate).toHaveBeenCalledWith(acquired, false);
  expect(usePhoneWorkspaceStore.getState()).toMatchObject({ open: true, selected: 'phone', controlConversationId: 'chat' });
});

it('allows completion on the physical phone without first acquiring browser control', async () => {
  await mount();
  vi.mocked(controlPhone).mockResolvedValue({ ...state, report: { ...state.report, status: 'ready' } });
  await act(async () => button('已完成，继续任务').click());
  expect(controlPhone).toHaveBeenCalledOnce();
  expect(controlPhone).toHaveBeenCalledWith('chat', state, 'handback');
  expect(usePhoneWorkspaceStore.getState().open).toBe(false);
});

it('keeps the request actionable after a failed handback', async () => {
  await mount();
  vi.mocked(controlPhone).mockRejectedValueOnce(new Error('手机暂未连接，进度已保留'));
  await act(async () => button('已完成，继续任务').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('进度已保留');
  expect(button('已完成，继续任务').disabled).toBe(false);
  expect(container.textContent).toContain('请在手机上完成登录');
});
