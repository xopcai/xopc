import { cp, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { Config } from '../../config/schema.js';
import { getConnectorConnection, getConnectorInstallation, upsertConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { getConnectorAccount } from '../../storage/sqlite/connector-account-repository.js';
import { createLogger } from '../../utils/logger.js';
import { getConnectorInstance, getInstalledConnectorDefinition } from '../instances.js';
import { getCliAdapter } from './adapterRegistry.js';
import { verifyInstalledCli } from './installer.js';
import { cliContextPath, startCliProcess } from './process.js';
import { cliAuthorizationView, commitCliIdentity, createCliAuthorization, readCliAuthorization, updateCliAuthorization, type CliAuthorization } from './store.js';
import type { CliAdapter } from './types.js';

const log = createLogger('CliConnectorAuth');
const controllers = new Map<string, AbortController>();

export function requireCliInstance(config: Config, instanceId: string, options: { allowDisabled?: boolean } = {}): CliAdapter {
  const instance = getConnectorInstance(config, instanceId);
  const definition = getInstalledConnectorDefinition(config, instanceId);
  if (!instance || (!options.allowDisabled && !instance.enabled) || definition?.runtime.type !== 'cli') throw new Error('CLI connector is not installed or is disabled.');
  const adapter = getCliAdapter(definition.runtime.adapterId);
  if (definition.runtime.adapterVersion !== adapter.version || definition.runtime.binaryVersion !== adapter.binaryVersion) throw new Error('CLI connector version does not match its adapter. Reinstall the connector.');
  return adapter;
}

export function extractAuthorizationUrl(text: string, allowedHosts: readonly string[], field?: string): string | undefined {
  const candidates: string[] = [];
  if (field) {
    for (const line of text.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (typeof event?.[field] === 'string') candidates.push(event[field]);
      } catch { /* Wait for a complete JSON event. */ }
    }
  } else {
    for (const match of text.matchAll(/https:\/\/[^\s"<>\\]+(?=[\s"<>])/g)) candidates.push(match[0]);
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && !url.port && allowedHosts.includes(url.hostname) && !url.username && !url.password) return url.href;
    } catch { /* Ignore an invalid challenge URL. */ }
  }
  return undefined;
}

async function authorize(adapter: CliAdapter, attempt: CliAuthorization, signal: AbortSignal): Promise<void> {
  let committed = false;
  try {
    const executable = await verifyInstalledCli(adapter);
    const previous = attempt.expected_account_id ? getConnectorAccount(attempt.expected_account_id) : undefined;
    const previousConnection = previous?.currentConnectionId ? getConnectorConnection(previous.currentConnectionId) : undefined;
    if (previousConnection) {
      if (previousConnection.provider !== 'cli' || previousConnection.metadata.runtimeInstanceId !== attempt.instance_id) throw new Error('Account belongs to another CLI instance.');
      await cp(cliContextPath(String(previousConnection.metadata.contextId)), cliContextPath(attempt.context_id), { recursive: true, errorOnExist: true, force: false, filter: source => relative(cliContextPath(String(previousConnection.metadata.contextId)), source) !== 'files' });
    }
    const steps = previousConnection ? adapter.authorizationSteps.filter(step => !step.initialOnly) : adapter.authorizationSteps;
    for (const [index, step] of steps.entries()) {
      const progress = { step: index + 1, totalSteps: steps.length };
      signal.throwIfAborted();
      updateCliAuthorization(attempt.id, { phase: 'preparing' });
      let output = '';
      let challengePublished = false;
      const handle = await startCliProcess({ adapter, executable, contextId: attempt.context_id, args: step.args,
        signal, timeoutMs: Math.max(1, attempt.expires_at - Date.now()),
        onOutput(_stream, chunk) {
          if (step.challenge !== 'url' || challengePublished) return;
          output = (output + chunk.toString('utf8')).slice(-32_768);
          const url = extractAuthorizationUrl(output, step.urlHosts ?? [], step.urlField);
          if (url) {
            challengePublished = updateCliAuthorization(attempt.id, { phase: 'awaiting_user', challenge: { type: 'open_url', url, ...progress } });
          }
        },
      });
      const qrTimer = step.challenge === 'qr' ? setInterval(() => {
        if (challengePublished) return;
        void stat(join(cliContextPath(attempt.context_id), 'files', 'authorization.png')).then(info => {
          if (info.isFile() && info.size > 0 && !signal.aborted) challengePublished = updateCliAuthorization(attempt.id,
            { phase: 'awaiting_user', challenge: { type: 'qr_code', artifactId: attempt.id, ...progress } });
        }).catch(() => undefined);
      }, 300) : undefined;
      let result;
      try { result = await handle.completion; } finally { if (qrTimer) clearInterval(qrTimer); }
      if ((!step.decodeResult && result.exitCode !== 0) || result.timedOut || result.aborted || result.outputTruncated) {
        log.warn({ attemptId: attempt.id, step: index + 1, exitCode: result.exitCode, timedOut: result.timedOut, aborted: result.aborted, outputTruncated: result.outputTruncated }, 'CLI authorization step did not complete');
        throw new Error(`Authorization step ${index + 1}/${steps.length} ${result.timedOut ? 'timed out' : 'failed'}. Retry authorization.`);
      }
      step.decodeResult?.(result);
    }
    signal.throwIfAborted();
    if (!updateCliAuthorization(attempt.id, { phase: 'verifying' })) throw new Error('Authorization was cancelled.');
    const probe = await startCliProcess({ adapter, executable, contextId: attempt.context_id, args: adapter.statusArgs, signal });
    const identity = adapter.decodeIdentity(await probe.completion);
    signal.throwIfAborted();
    commitCliIdentity(attempt, identity);
    committed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization failed.';
    updateCliAuthorization(attempt.id, { phase: signal.aborted ? 'cancelled' : 'failed', error: message });
    log.warn({ attemptId: attempt.id, connectorId: attempt.connector_id, errorMessage: message }, 'CLI authorization did not complete');
  } finally {
    controllers.delete(attempt.id);
    if (!committed) await rm(cliContextPath(attempt.context_id), { recursive: true, force: true });
  }
}

export function startCliAuthorization(config: Config, instanceId: string, expectedAccountId?: string) {
  const adapter = requireCliInstance(config, instanceId);
  const definition = getInstalledConnectorDefinition(config, instanceId)!;
  if (expectedAccountId) {
    const account = getConnectorAccount(expectedAccountId);
    if (!account || account.connectorId !== definition.id) throw new Error('Invalid account.');
  }
  const installationId = `${definition.id}-local-owner`;
  if (!getConnectorInstallation(installationId)) upsertConnectorInstallation({ id: installationId, connectorId: definition.id, principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
  const attempt = createCliAuthorization(instanceId, definition.id, expectedAccountId);
  const controller = new AbortController();
  controllers.set(attempt.id, controller);
  void authorize(adapter, attempt, controller.signal).catch(error => log.error({ err: error, attemptId: attempt.id }, 'CLI authorization cleanup failed'));
  return cliAuthorizationView(attempt);
}

export function cancelCliAuthorization(id: string): void {
  const attempt = readCliAuthorization(id);
  if (!attempt) throw new Error('Authorization not found.');
  updateCliAuthorization(id, { phase: 'cancelled' });
  controllers.get(id)?.abort();
}

export function cancelCliInstanceAuthorizations(instanceId: string): void {
  for (const id of controllers.keys()) {
    if (readCliAuthorization(id)?.instance_id === instanceId) cancelCliAuthorization(id);
  }
}
