// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExternalIntakeHost } from '../external-intake-host';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn(), deliver: vi.fn(), load: vi.fn() }));
vi.mock('@/features/sessions/session-api', () => ({ listSessions: mocks.list, getSessionDetail: mocks.detail }));
vi.mock('../session/session-manager', () => ({ SessionManager: class { createSession = mocks.create; } }));
vi.mock('../session/local-session-drafts', () => ({ readLocalSessionDraft: async () => undefined }));
vi.mock('../agent-selection/chat-agents-api', () => ({ fetchChatAgents: async () => ({ defaultId: 'default-agent', items: [] }) }));
vi.mock('../composer/external-intake-receiver', () => ({ deliverExternalIntake: mocks.deliver }));
vi.mock('../attachments/attachment-load', () => ({ loadAttachment: mocks.load }));

const currentId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
let root: ReturnType<typeof createRoot>;
let node: HTMLDivElement;
let intake: NonNullable<NonNullable<Window['electronAPI']>['intake']>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('crypto', { subtle: { digest: async () => new Uint8Array(32).buffer } });
  useGatewayStore.setState({ conversationId: 'principal', baseUrl: '' });
  useLocaleStore.setState({ language: 'zh' });
  mocks.list.mockResolvedValue({ items: [] });
  mocks.detail.mockResolvedValue({ key: currentId, name: '已有对话', agentId: 'existing-agent', status: 'active' });
  mocks.create.mockResolvedValue({ key: newId });
  mocks.deliver.mockResolvedValue(undefined);
  mocks.load.mockImplementation(async (file: File) => ({ type: 'image', name: file.name, size: 3, content: 'AAH/', mimeType: 'image/png' }));
  let pending = true;
  intake = { list: vi.fn(async () => pending ? [{ id: 'batch-1', createdAt: Date.now(), items: [{ id: 'item-1', name: 'image.png', size: 3 }] }] : []),
    release: vi.fn(async () => {}), read: vi.fn(async () => 'AAH/'), target: vi.fn(async () => {}),
    remove: vi.fn(async () => { pending = false; }), onChanged: () => () => {} };
  window.electronAPI = { intake } as Window['electronAPI'];
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); delete window.electronAPI; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/chat/${currentId}`]}><ExternalIntakeHost /></MemoryRouter>));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
function button(label: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === label)!; }

it('defaults to a local new conversation, resolves the default agent and delivers bytes without sending', async () => {
  await render();
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => button('加入新对话').click());
  expect(mocks.create).toHaveBeenCalledWith({ agentId: 'default-agent' });
  expect(mocks.deliver).toHaveBeenCalledWith(JSON.stringify(['principal', newId]), 'batch-1', [expect.objectContaining({ id: 'intake:batch-1:item-1', content: 'AAH/' })]);
  expect(intake.remove).toHaveBeenCalledWith('batch-1');
});

it('uses the explicitly selected existing conversation without creating a new conversation', async () => {
  await render();
  const radio = document.querySelectorAll<HTMLInputElement>('input[type=radio]')[1]!;
  await act(async () => radio.click());
  await act(async () => button('加入输入框').click());
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.deliver).toHaveBeenCalledWith(JSON.stringify(['principal', currentId]), 'batch-1', expect.any(Array));
});

it('keeps the batch available when draft delivery fails and cancels without creating a conversation', async () => {
  await render();
  mocks.deliver.mockRejectedValueOnce(new Error('storage full'));
  await act(async () => button('加入新对话').click());
  expect(document.body.textContent).toContain('storage full');
  expect(intake.remove).not.toHaveBeenCalled();
});

it('cancels before selection without allocating a new conversation', async () => {
  await render();
  await act(async () => button('取消').click());
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.deliver).not.toHaveBeenCalled();
  expect(intake.remove).toHaveBeenCalledWith('batch-1');
});
