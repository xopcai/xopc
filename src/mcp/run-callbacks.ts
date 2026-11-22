import { createHmac } from 'node:crypto';
import { request } from 'node:https';
import { isIP } from 'node:net';

import { assertSafeUrl } from '../media-shared/http/ssrf-guard.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { createLogger } from '../utils/logger.js';
import { resolveMcpCallbackSecret, type McpConnectionCallback } from './callback-config.js';
import { isMcpGrantExpired, readMcpConnectionGrant } from './connection-grants.js';
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

function resolveConnectionGrantCallback(
  connectionId: string,
  remoteGrants: ReturnType<typeof listRemoteMcpGrants>,
): { active: boolean; callback?: McpConnectionCallback } {
  const remote = remoteGrants.find(grant => grant.connectionId === connectionId);
  if (remote) {
    return {
      active: remote.capabilityIds.includes('xopc.agent_runs.start'),
      callback: remote.callback,
    };
  }
  const local = readMcpConnectionGrant(connectionId);
  if (local && !isMcpGrantExpired(local)) {
    return {
      active: local.capabilityIds.includes('xopc.agent_runs.start'),
      callback: local.callback,
    };
  }
  return { active: false };
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
    const globalConfig = getConfig();
    const now = Date.now();
    if (this.#stop.signal.aborted || now < this.#nextDispatch) return;
    this.#nextDispatch = now + 2_000;
    const remoteGrants = listRemoteMcpGrants();

    for (const [runId, subscription] of subscriptions) {
      if (this.#inFlight.size >= 4) break;
      if (this.#inFlight.has(runId) || subscription.nextAttemptAt > now) continue;
      const id = subscription.principalId.slice('mcp:'.length);
      const grantState = resolveConnectionGrantCallback(id, remoteGrants);
      const target = subscription.perConnection ? grantState.callback : (grantState.callback?.url === subscription.url ? grantState.callback : globalConfig);
      const secret = resolveMcpCallbackSecret(target);
      if (!grantState.active || !target || !secret || subscription.url !== target.url || !this.#runs.get(runId)) {
        subscriptions.delete(runId);
        continue;
      }
      const event = this.#runs.listEvents(runId, subscription.sequence).find(item =>
        terminalEvents.has(item.type) || (item.type === 'task_run.wait_created' && item.payload.kind === 'user_input'));
      if (!event) continue;
      const payload = JSON.stringify({ eventId: event.id, runId, type: event.type, sequence: event.sequence, occurredAt: event.occurredAt });
      this.#inFlight.add(runId);
      void postEvent(
        new URL(target.url),
        secret,
        event.id,
        payload,
        AbortSignal.any([this.#stop.signal, AbortSignal.timeout(5_000)]),
        () => {
          if (!isXopcDatabaseOpen()) return false;
          const currentRemote = listRemoteMcpGrants();
          const currentGrant = resolveConnectionGrantCallback(id, currentRemote);
          if (!currentGrant.active) return false;
          const currentTarget = subscription.perConnection ? currentGrant.callback : (currentGrant.callback?.url === subscription.url ? currentGrant.callback : getConfig());
          return currentTarget?.url === subscription.url && Boolean(resolveMcpCallbackSecret(currentTarget));
        },
      )
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
