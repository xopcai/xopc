import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn(async () => ({ messageId: 'acknowledged' })));
vi.mock('../messaging/send.js', async original => ({ ...await original<typeof import('../messaging/send.js')>(), sendMessageWeixin: send }));

import { createWeixinOutboundHandlers } from '../outbound-send.js';
import { saveWeixinAccount } from '../auth/accounts.js';
import { setContextToken, clearContextTokensForAccount } from '../messaging/inbound.js';
import type { ChannelOutboundContext } from '@xopcai/xopc/channels/plugin-types.js';

let root: string;
beforeEach(() => {
  send.mockClear(); root = mkdtempSync(join(tmpdir(), 'xopc-weixin-identity-')); vi.stubEnv('XOPC_STATE_DIR', root);
  for (const id of ['bot-a', 'bot-b']) saveWeixinAccount(id, { token: `fixture-${id}`, baseUrl: 'http://127.0.0.1:1' });
});
afterEach(() => { for (const id of ['bot-a', 'bot-b']) clearContextTokensForAccount(id); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function context(): ChannelOutboundContext {
  return { cfg: { channels: { weixin: { enabled: true, accounts: { 'bot-a': {}, 'bot-b': {} } } } } as any,
    accountId: 'bot-a', to: 'alice@im.wechat', text: 'Already verified data', outboundMetadata: { strictWeixinIdentity: true } };
}
it('does not replace an explicitly bound account with another account that has a context token', async () => {
  setContextToken('bot-b', 'alice@im.wechat', 'foreign-context', { sendToUserId: 'alice@im.wechat' });
  expect(await createWeixinOutboundHandlers().sendText(context())).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});
it('does not accept a different raw recipient from a cached prefix match', async () => {
  setContextToken('bot-a', 'alice@im.wechat', 'own-context', { sendToUserId: 'alice-other@im.wechat' });
  expect(await createWeixinOutboundHandlers().sendText(context())).toMatchObject({ success: false });
  expect(send).not.toHaveBeenCalled();
});
it('sends the existing result using exactly the original account and raw recipient', async () => {
  setContextToken('bot-a', 'alice@im.wechat', 'own-context', { sendToUserId: 'alice@im.wechat' });
  expect(await createWeixinOutboundHandlers().sendText(context())).toMatchObject({ success: true });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ toUserIdForApi: 'alice@im.wechat', opts: expect.objectContaining({ token: 'fixture-bot-a', contextToken: 'own-context' }) }));
});
