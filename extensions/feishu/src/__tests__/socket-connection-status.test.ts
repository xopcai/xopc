import { expect, it, vi } from 'vitest';

import type { Config } from '@xopcai/xopc/config/schema.js';

import { resolveFeishuAccount } from '../state/accounts.js';
import { createFeishuSocketModeMonitor } from '../transport/socket-mode/monitor.js';

const { start, close } = vi.hoisted(() => ({ start: vi.fn(), close: vi.fn() }));
vi.mock('../transport/client/client.js', () => ({
  createFeishuClient: (_account: unknown, lifecycle: unknown) => ({
    wsClient: { start: () => start(lifecycle), close },
    dispatcher: { register: vi.fn() },
  }),
}));
vi.mock('../transport/reliability/message-ingress.js', () => ({
  createFeishuMessageIngress: () => ({ start: vi.fn(), settled: vi.fn() }),
}));

it.each([
  ['514', 'credentials_rejected'],
  ['403', 'connection_rejected'],
])('reports a terminal Feishu endpoint rejection with code %s', async (code, issue) => {
  const config = {
    channels: { feishu: { enabled: true, accounts: { team: { appId: 'fixture', appSecret: 'fixture' } } } },
  } as Config;
  const { signal } = new AbortController();
  const onState = vi.fn();
  start.mockImplementation(({ onError }) => {
    onError(new Error(`pullConnectConfig failed: code=${code}, msg=fixture`));
    return Promise.resolve();
  });

  await createFeishuSocketModeMonitor({
    account: resolveFeishuAccount(config, 'team'), config, abortSignal: signal, onState,
    enqueueInbound: vi.fn(), inboundDebounceDefaultMs: 0, security: { checkAccess: vi.fn() },
  }).run();

  expect(onState.mock.calls).toEqual([['connecting'], [issue]]);
  expect(close).toHaveBeenCalledWith({ force: true });
});
