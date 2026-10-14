// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionWaitSnapshot } from '@xopcai/gateway-contract';

import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import { useConnectionWait } from '../use-connection-wait';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({ readLocalSessionDraft: async () => undefined }));

let model: ReturnType<typeof useConnectionWait>;
let snapshot: ConnectionWaitSnapshot;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Probe() { model = useConnectionWait('one'); return <div>{model.wait?.id ?? 'resolved'}</div>; }
const mount = async () => {
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe /></SWRConfig>);
  });
  await vi.waitFor(() => expect(model.wait?.id).toBe('wait'));
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  useChatSessionStore.setState({ sessions: {} });
  snapshot = { transcriptId: 'transcript', revision: 1, wait: {
    id: 'wait', conversationId: 'one', transcriptId: 'transcript', principalId: 'local-owner', agentId: 'main',
    objectiveId: 'objective', objectiveRevision: 1, objectiveUpdatedAt: 1, originInputId: 'input', originRunId: 'run',
    summary: 'Read mail', status: 'open', phase: 'needs_connection', version: 1, createdAt: 1, updatedAt: 1,
    needs: [{ key: 'gmail', target: { type: 'connector', connectorId: 'composio-gmail' }, label: 'Gmail', capabilities: [],
      phase: 'choose_account', authorizationMode: 'browser', accounts: [{ id: 'work', label: 'Work' }] }],
  } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('cancels during an outstanding check, refreshes a phase conflict, and ignores its late snapshot', async () => {
  let finishCheck!: (value: unknown) => void;
  const posts: Array<{ action: string; expectedVersion: number; expectedObjectiveRevision?: number }> = [];
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    const command = JSON.parse(init.body); posts.push(command);
    if (command.action === 'check') {
      snapshot.revision = 2; snapshot.wait!.version = 2; snapshot.wait!.recoveryStage = 'checking_connection';
      return new Promise(resolve => { finishCheck = resolve; });
    }
    if (command.expectedVersion !== snapshot.wait!.version) throw Object.assign(new Error('WAIT_CHANGED'), { status: 409 });
    snapshot = { transcriptId: 'transcript', revision: 3, wait: null };
    return { payload: { snapshot: structuredClone(snapshot) } };
  });
  await mount();
  let checking!: Promise<boolean>;
  await act(async () => { checking = model.act('check'); });
  expect(model.busy).toBe(true);
  const late = { transcriptId: 'transcript', revision: 2, wait: { ...snapshot.wait! } };
  await act(async () => { expect(await model.act('cancel')).toBe(true); });
  expect(posts.map(command => [command.action, command.expectedVersion])).toEqual([['check', 1], ['cancel', 1], ['cancel', 2]]);
  expect(posts.filter(command => command.action === 'cancel').every(command => command.expectedObjectiveRevision === 1)).toBe(true);
  await act(async () => { finishCheck({ payload: { snapshot: late } }); await checking; });
  expect(model.wait).toBeNull();
  expect(model.busy).toBe(false);
});

it('does not automatically cancel an objective revised since the user clicked', async () => {
  let posts = 0;
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    posts += 1;
    snapshot.wait!.objectiveRevision += 1; snapshot.wait!.version += 1; snapshot.revision += 1;
    throw Object.assign(new Error('WAIT_CHANGED'), { status: 409 });
  });
  await mount();
  await act(async () => { expect(await model.act('cancel')).toBe(false); });
  expect(posts).toBe(1);
  expect(model.wait?.objectiveRevision).toBe(2);
  expect(model.error).toBeTruthy();
});

it('reports cancellation failure if repeated conflicts prevent confirmation', async () => {
  let posts = 0;
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    posts += 1;
    expect(JSON.parse(init.body).expectedObjectiveRevision).toBe(1);
    snapshot.wait!.version += 1; snapshot.revision += 1;
    throw Object.assign(new Error('WAIT_CHANGED'), { status: 409 });
  });
  await mount();
  await act(async () => { expect(await model.act('cancel')).toBe(false); });
  expect(posts).toBe(2);
  expect(model.wait?.id).toBe('wait');
  expect(model.error).toBeTruthy();
});

it('retains a dismissible cancellation error when the objective has entered execution', async () => {
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    snapshot = { transcriptId: 'transcript', revision: 2, wait: null };
    throw Object.assign(new Error('WAIT_CHANGED'), { status: 409 });
  });
  await mount();
  await act(async () => { expect(await model.act('cancel')).toBe(false); });
  expect(model.wait).toBeNull();
  expect(model.error).toBeTruthy();
  await act(async () => model.dismissError());
  expect(model.error).toBeUndefined();
  expect(model.cancellationError).toBeUndefined();
});

it('does not misreport a successful cancellation when its old check later fails', async () => {
  let failCheck!: (error: Error) => void;
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    if (JSON.parse(init.body).action === 'check') return new Promise((_resolve, reject) => { failCheck = reject; });
    snapshot = { transcriptId: 'transcript', revision: 2, wait: null };
    return { payload: { snapshot: structuredClone(snapshot) } };
  });
  await mount();
  let checking!: Promise<boolean>;
  await act(async () => { checking = model.act('check'); });
  await act(async () => { expect(await model.act('cancel')).toBe(true); });
  await act(async () => {
    failCheck(Object.assign(new Error('Connection objective cancelled'), { status: 400 }));
    expect(await checking).toBe(false);
  });
  expect(model.wait).toBeNull();
  expect(model.cancellationError).toBeUndefined();
});

it('reuses an account selection command key after its response is lost', async () => {
  const keys: string[] = [];
  fetchJson.mockImplementation(async (_url: string, init?: { body: string }) => {
    if (!init) return { payload: structuredClone(snapshot) };
    keys.push(JSON.parse(init.body).idempotencyKey);
    if (keys.length === 1) {
      snapshot.wait!.version = 2; snapshot.revision = 2;
      throw new TypeError('Response lost');
    }
    return { payload: { snapshot: structuredClone(snapshot) } };
  });
  await mount();
  await act(async () => { expect(await model.act('select_account', 'gmail', 'work')).toBe(false); });
  await act(async () => { expect(await model.act('select_account', 'gmail', 'work')).toBe(true); });
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

it('refreshes the authoritative wait when realtime reconnects', async () => {
  fetchJson.mockImplementation(async () => ({ payload: structuredClone(snapshot) }));
  await mount();
  snapshot = { transcriptId: 'transcript', revision: 2, wait: null };
  await act(async () => { window.dispatchEvent(new CustomEvent('gateway-realtime-connected')); });
  await vi.waitFor(() => expect(model.wait).toBeNull());
});
