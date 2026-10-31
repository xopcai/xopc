import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** Only inference is deterministic; Gateway, storage, UI, IPC, PTY and WS are real. */
export async function createLocalConnectionFixture(state) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Connection acceptance</title><p>XOPC_LOCAL_BROWSER_OK</p>');
      return;
    }
    if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
    for await (const _chunk of request) { /* Drain the bounded fixture request. */ }
    requests++;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const delta of [{ role: 'assistant' }, { content: 'XOPC_LOCAL_CHAT_OK' }, {}]) {
      response.write(`data: ${JSON.stringify({ id: 'connection-e2e', object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000), model: 'connection',
        choices: [{ index: 0, delta, finish_reason: Object.keys(delta).length ? null : 'stop' }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const outside = join(state, 'outside-authorized-workspace.txt');
  await writeFile(outside, 'This fixture must not be readable through workspace file IPC.');
  await writeFile(join(state, 'models.json'), JSON.stringify({ providers: {
    'connection-e2e': { baseUrl: `${base}/v1`, apiKey: 'isolated-fixture', api: 'openai-completions',
      models: [{ id: 'connection', name: 'Connection fixture', reasoning: false, input: ['text'],
        contextWindow: 128000, maxTokens: 2000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] },
  } }));
  return {
    base,
    outside,
    requests: () => requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export async function verifyLocalConnectionFunctions(page, fixture, until) {
  const prepared = await page.evaluate(async () => {
    const api = async (path, body, method = 'POST') => {
      const response = await fetch(path, { method, signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      const data = await response.json();
      return data.payload ?? data;
    };
    const agents = await api('/api/agents', undefined, 'GET');
    const list = agents.agents ?? agents.items ?? agents;
    const agent = list.find(agent => agent.isDefault || agent.id === agents.defaultId) ?? list[0];
    const { defaults } = await api('/api/global-defaults', undefined, 'GET');
    defaults.models.chat = { primary: 'connection-e2e/connection', fallbacks: [] };
    await api('/api/global-defaults', { defaults, scope: 'models' }, 'PATCH');
    await api(`/api/agents/${encodeURIComponent(agent.id)}`, {
      models: { chat: { primary: 'connection-e2e/connection', fallbacks: [] } },
    }, 'PATCH');
    const conversationId = crypto.randomUUID();
    const origin = (await window.electronAPI.computer.status()).claim;
    const accepted = await api(`/api/sessions/${conversationId}/inputs`, {
      kind: 'start', clientMessageId: crypto.randomUUID(),
      creation: { agentId: agent.id, projectId: null, execution: null, temporary: false,
        model: 'connection-e2e/connection', thinkingLevel: 'off' },
      input: { content: 'Reply with the local connection acceptance marker.' }, origin,
    });
    if (!accepted.receipt?.inputId) throw new Error('Missing durable input receipt');
    const compatibility = await api('/api/endpoint-tools/compatibility', undefined, 'GET');
    const clientId = crypto.randomUUID();
    const ticket = await api('/api/realtime/tickets', { clientId, clientKind: 'desktop',
      protocolVersion: compatibility.realtimeProtocolVersion });
    window.__connectionEvents = [];
    window.__connectionSocket = new WebSocket(location.origin.replace('http:', 'ws:') + '/api/realtime/v1/ws');
    window.__connectionSocket.onopen = () => window.__connectionSocket.send(JSON.stringify({
      protocolVersion: compatibility.realtimeProtocolVersion, messageId: crypto.randomUUID(), sentAt: Date.now(),
      kind: 'realtime.hello', payload: { ticket: ticket.ticket, clientId, clientKind: 'desktop',
        subscriptions: [{ topic: 'gateway', afterSeq: 0 }, { topic: 'sessions', afterSeq: 0 }] },
    }));
    window.__connectionSocket.onmessage = event => window.__connectionEvents.push(JSON.parse(event.data));
    return { conversationId, workspace: accepted.agentConfig.effectiveWorkspacePath };
  });
  console.log('Functional: durable input accepted; verifying realtime delivery');
  await until(() => page.evaluate(conversationId => window.__connectionEvents.some(event =>
    event.kind === 'realtime.event' && event.payload.event === 'session.input-state'
      && event.payload.data?.conversationId === conversationId), prepared.conversationId), 30_000);
  const events = await page.evaluate(() => {
    const kinds = [...new Set(window.__connectionEvents.map(event => event.kind))];
    window.__connectionSocket.close();
    return kinds;
  });
  assert(events.includes('realtime.ready'));
  await until(() => fixture.requests() > 0, 30_000);
  console.log('Functional: realtime delivered; verifying rendered chat');
  await page.goto(`${new URL(page.url()).origin}/#/chat/${prepared.conversationId}`);
  const dismiss = page.getByRole('button', { name: 'Maybe later, keep using my current model', exact: true });
  if (await dismiss.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await dismiss.click();
  }
  const skip = page.getByRole('button', { name: 'Skip for now', exact: true });
  if (await skip.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    await skip.click({ timeout: 10_000 });
  }
  await page.getByRole('main').getByText('XOPC_LOCAL_CHAT_OK', { exact: true }).first().waitFor({ timeout: 30_000 });
  console.log('Functional: chat rendered; verifying native file, PTY and browser IPC');
  const checks = await page.evaluate(async ({ conversationId, workspace, browserUrl, outside }) => {
    const path = `${workspace}/connection-acceptance.txt`;
    const write = await window.electronAPI.file.writeFile(path, 'XOPC_LOCAL_FILE_OK');
    if (!write.success) throw new Error('Native file write failed');
    if (await window.electronAPI.file.readFile(path) !== 'XOPC_LOCAL_FILE_OK') throw new Error('Native file read failed');
    let denied = false;
    try { await window.electronAPI.file.readFile(outside); } catch { denied = true; }
    if (!denied) throw new Error('Native file IPC escaped its allowed roots');
    const response = await fetch(`/api/sessions/resolve?conversationId=${conversationId}`, { signal: AbortSignal.timeout(5000) });
    const { payload: session } = await response.json();
    const terminalKey = crypto.randomUUID();
    let output = '';
    const off = window.electronAPI.terminal.onData(event => { output += event.data; });
    const errors = [];
    const offError = window.electronAPI.terminal.onError(event => errors.push(event.message));
    try {
      const terminal = await window.electronAPI.terminal.create({ conversationId,
        transcriptId: session.transcriptId, terminalKey, cols: 80, rows: 24 });
      window.electronAPI.terminal.write(terminal.terminalId, "printf 'XOPC_LOCAL_PTY_%s\\n' 'OK'\r");
      const deadline = performance.now() + 10_000;
      while (!output.includes('XOPC_LOCAL_PTY_OK') && performance.now() < deadline) {
        if (errors.length) throw new Error(errors.join('; '));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!output.includes('XOPC_LOCAL_PTY_OK')) throw new Error('PTY command did not complete');
      if (terminal.cwd !== workspace) throw new Error('PTY workspace does not match the Gateway');
    } finally {
      off(); offError();
      await window.electronAPI.terminal.dispose(session.transcriptId, terminalKey);
    }
    const tab = await window.electronAPI.browser.ensure({ workspaceTabId: crypto.randomUUID(),
      scope: conversationId, identity: `connection-e2e:${conversationId}` });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { off(); reject(new Error('Embedded browser did not load its fixture')); }, 10_000);
        const off = window.electronAPI.browser.onEvent(event => {
          if (event.kind !== 'state' || event.state.id !== tab.id) return;
          if (event.state.title === 'Connection acceptance' && !event.state.loading) {
            clearTimeout(timeout); off(); resolve();
          }
        });
        window.electronAPI.browser.navigate(tab.id, browserUrl).catch(error => {
          clearTimeout(timeout); off(); reject(error);
        });
      });
    } finally { await window.electronAPI.browser.close(tab.id); }
    return { chatRendered: true, cookieApi: true, realtimeSessionEvent: true,
      nativeFileReadWrite: true, nativeFileBoundary: true, nativePty: true, embeddedBrowserLoaded: true };
  }, { ...prepared, browserUrl: fixture.base, outside: fixture.outside });
  return { ...checks, conversationId: prepared.conversationId };
}
