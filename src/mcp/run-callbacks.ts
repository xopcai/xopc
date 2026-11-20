import { createHmac } from 'node:crypto';
import { request } from 'node:https';
import { isIP } from 'node:net';

import { assertSafeUrl } from '../media-shared/http/ssrf-guard.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { createLogger } from '../utils/logger.js';
import { readMcpConnectionGrant } from './connection-grants.js';
import { listRemoteMcpGrants } from './remote-grants.js';
import { mcpRunCallbackSubscriptions as subscriptions, type CallbackConfig } from './run-callback-subscriptions.js';

const terminalEvents = new Set(['task_run.succeeded', 'task_run.failed', 'task_run.cancelled']);
const log = createLogger('McpRunCallbacks');

async function postEvent(url: URL, secret: string, eventId: string, payload: string, signal: AbortSignal, isActive: () => boolean) {
  const { resolvedIp } = await assertSafeUrl(url);
  signal.throwIfAborted();
  if (!isActive()) throw new Error('Callback authorization is unavailable');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  await new Promise<void>((resolve, reject) => {
    // Use the validated address while retaining the configured hostname for TLS and Host.
    const req = request({
      hostname: resolvedIp, servername: isIP(hostname) ? '' : hostname,
      port: url.port || 443, path: url.pathname, method: 'POST', signal, agent: false,
      headers: {
        Host: url.host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
        'X-Xopc-Event-Id': eventId, 'X-Xopc-Timestamp': timestamp, 'X-Xopc-Signature': `sha256=${signature}`,
      },
    }, response => {
      response.destroy();
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error(`Callback returned HTTP ${response.statusCode}`));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

export class McpRunCallbackDispatcher {
  readonly #inFlight = new Set<string>();
  readonly #stop = new AbortController();
  readonly #runs = new TaskRunRepository();
  #nextDispatch = 0;

  stop(): void {
    this.#stop.abort();
  }

  dispatch(getConfig: () => CallbackConfig): void {
    const config = getConfig();
    const secret = config && process.env[config.secretEnv];
    const now = Date.now();
    if (!config || !secret || this.#stop.signal.aborted || now < this.#nextDispatch) return;
    this.#nextDispatch = now + 2_000;
    const remoteConnections = new Set(listRemoteMcpGrants()
      .filter(grant => grant.capabilityIds.includes('xopc.agent_runs.start')).map(grant => grant.connectionId));
    for (const [runId, subscription] of subscriptions) {
      if (this.#inFlight.size >= 4) break;
      if (this.#inFlight.has(runId) || subscription.nextAttemptAt > now) continue;
      const id = subscription.principalId.slice('mcp:'.length);
      if (subscription.url !== config.url || !this.#runs.get(runId)
        || !(remoteConnections.has(id) || readMcpConnectionGrant(id)?.capabilityIds.includes('xopc.agent_runs.start'))) {
        subscriptions.delete(runId);
        continue;
      }
      const event = this.#runs.listEvents(runId, subscription.sequence).find(item =>
        terminalEvents.has(item.type) || (item.type === 'task_run.wait_created' && item.payload.kind === 'user_input'));
      if (!event) continue;
      const payload = JSON.stringify({ eventId: event.id, runId, type: event.type, sequence: event.sequence, occurredAt: event.occurredAt });
      this.#inFlight.add(runId);
      void postEvent(new URL(config.url), secret, event.id, payload,
        AbortSignal.any([this.#stop.signal, AbortSignal.timeout(5_000)]),
        () => isXopcDatabaseOpen() && getConfig()?.url === config.url
          && Boolean(readMcpConnectionGrant(id)?.capabilityIds.includes('xopc.agent_runs.start')
            || listRemoteMcpGrants().some(grant => grant.connectionId === id && grant.capabilityIds.includes('xopc.agent_runs.start'))))
        .then(() => {
          if (this.#stop.signal.aborted || !isXopcDatabaseOpen()) return;
          if (terminalEvents.has(event.type)) subscriptions.delete(runId);
          else subscriptions.set(runId, { ...subscription, sequence: event.sequence, attempts: 0, nextAttemptAt: 0 });
        }, () => {
          if (this.#stop.signal.aborted || !isXopcDatabaseOpen()) return;
          const attempts = subscription.attempts + 1;
          if (attempts >= 5) {
            log.warn({ runId, eventId: event.id }, 'MCP run callback delivery exhausted retries');
            if (terminalEvents.has(event.type)) subscriptions.delete(runId);
            else subscriptions.set(runId, { ...subscription, sequence: event.sequence, attempts: 0, nextAttemptAt: 0 });
          } else {
            subscriptions.set(runId, { ...subscription, attempts, nextAttemptAt: Date.now() + 2_000 * 2 ** attempts });
          }
        }).catch(err => log.error({ err, runId }, 'Failed to persist MCP run callback delivery state'))
        .finally(() => this.#inFlight.delete(runId));
    }
  }
}
