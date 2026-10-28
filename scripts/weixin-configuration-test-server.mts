/** Local ilink protocol peer. It uses production channel adapters, never mocks model/tool responses. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

export async function createWeixinConfigurationTestServer() {
  const tokens = { 'bot-a': randomUUID(), 'bot-b': randomUUID() };
  const queues = new Map<string, any[]>();
  const contexts = new Map<string, string>();
  const messages: Array<{ accountId: string; to: string; content: string; context: string; atMs: number; success: boolean }> = [];
  let polls = 0, failContent = '';
  const server = createServer((request, response) => { void (async () => {
    const accountId = Object.entries(tokens).find(([, token]) => request.headers.authorization === `Bearer ${token}`)?.[0];
    if (!accountId) { response.writeHead(401).end(); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw), path = new URL(request.url!, 'http://localhost').pathname;
    let result: any = { ret: 0 };
    if (path.endsWith('/getupdates')) {
      polls++;
      if (!(queues.get(accountId)?.length)) await delay(500);
      result = { ret: 0, msgs: queues.get(accountId)?.splice(0) ?? [], get_updates_buf: String(polls), longpolling_timeout_ms: 1000 };
    } else if (path.endsWith('/sendmessage')) {
      const msg = input.msg;
      const text = (msg.item_list ?? []).map((item: any) => item.text_item?.text ?? '').join('');
      assert.equal(msg.context_token, contexts.get(`${accountId}:${msg.to_user_id}`), 'Outbound must echo the current account/peer context token');
      const success = !(failContent && text.includes(failContent));

      messages.push({ accountId, to: msg.to_user_id, content: text, context: msg.context_token, atMs: Date.now(), success });
      result = success ? { ret: 0 } : { ret: -1, errmsg: 'Injected test delivery failure' };
    } else if (path.endsWith('/getconfig')) result = { ret: 0, typing_ticket: 'fixture-typing' };
    else if (!path.endsWith('/sendtyping')) result = { ret: -1, errmsg: 'Unsupported fixture endpoint' };
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
  })().catch(() => response.writeHead(500).end()); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, tokens, messages,
    get polls() { return polls; }, blockMessagesContaining(value: string) { failContent = value; }, allowMessages() { failContent = ''; },
    send(accountId: keyof typeof tokens, peer: string, content: string) {
      const context = randomUUID(); contexts.set(`${accountId}:${peer}`, context);
      const queue = queues.get(accountId) ?? []; queues.set(accountId, queue);
      queue.push({ message_id: randomUUID(), from_user_id: peer, message_type: 1, message_state: 2, context_token: context,
        create_time_ms: Date.now(), item_list: [{ type: 1, text_item: { text: content } }] });
    },
    async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
