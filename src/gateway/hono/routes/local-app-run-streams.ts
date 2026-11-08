import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { onAutomationRunChange } from '../../../automations/run-changes.js';
import { capabilityHttpContext, capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError, type CapabilityDispatcher } from '../../../capabilities/runtime/dispatcher.js';
import { localAppCapabilities } from '../../../local-apps/capabilities/runtime.js';
import { localAppResourceAllowed } from '../../../local-apps/capabilities/resource-policy.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { localAppDelegationCaller } from '../../security/local-app-delegation-access.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const subscriptions = new Map<string, number>();
export function registerLocalAppRunStreams(app: Hono, deps: AuthenticatedRouteDeps, dispatcher: CapabilityDispatcher): void {
  app.get('/api/local-app-capabilities/:extensionId/runs/:runId/events', async c => {
    try {
      const extensionId = c.req.param('extensionId'), runId = z.uuid().parse(c.req.param('runId'));
      const manifestDigest = z.string().regex(/^[a-f0-9]{64}$/).parse(c.req.query('manifestDigest'));
      const grantRevision = z.uuid().parse(c.req.query('grantRevision'));
      const caller = localAppDelegationCaller(capabilityHttpContext(c), getGatewayPrincipal(c), () => deps.service.getResolvedAuth());
      const runtime = () => localAppCapabilities(deps.service.localApps, dispatcher, extensionId, manifestDigest, caller, grantRevision);
      const snapshot = async () => {
        const access = runtime();
        const contracts = access.list().capabilities;
        const invoke = (id: string) => {
          const contract = contracts.find(item => item.id === id);
          if (!contract) throw new CapabilityError('FORBIDDEN', 'Run subscription requires declared run and event read capabilities');
          return access.call(id, { ...contract, input: { id: runId } });
        };
        const run = await invoke('xopc.automations.get_run');
        const events = await invoke('xopc.automations.run_events');
        return { ...run.data as object, ...events.data as object };
      };
      await snapshot();
      if ((subscriptions.get(extensionId) ?? 0) >= 4 || [...subscriptions.values()].reduce((a, b) => a + b, 0) >= 32) throw new CapabilityError('UNAVAILABLE', 'Run subscription capacity reached');
      subscriptions.set(extensionId, (subscriptions.get(extensionId) ?? 0) + 1);
      return streamSSE(c, async stream => {
        let changed = false, wake: (() => void) | undefined;
        let sequence = 0;
        const notify = () => { changed = true; wake?.(); };
        const stop = onAutomationRunChange(runId, notify);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => wake?.();
        stream.onAbort(abort);
        try {
          const deadline = Date.now() + 15 * 60000;
          for (;;) {
            caller.assertCurrent?.();
            const access = deps.service.localApps.getCapabilityAccess(extensionId, manifestDigest, grantRevision);
            if (!localAppResourceAllowed(extensionId, access.resourceScopes, 'xopc.automations.get_run', { id: runId })) throw new CapabilityError('FORBIDDEN', 'Run access changed');
            if (sequence === 0 || changed) {
              changed = false;
              const value = await snapshot();
              caller.assertCurrent?.(); runtime().list();
              await stream.writeSSE({ event: 'snapshot', id: String(++sequence), data: JSON.stringify(value) });
              const status = (value as { run?: { status?: string } }).run?.status;
              if (status && !['queued', 'running', 'cancelling'].includes(status)) break;
            }
            if (changed) continue;
            if (stream.aborted || Date.now() >= deadline) break;
            await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 1000); });
            clearTimeout(timer); wake = undefined;
            if (stream.aborted) break;
          }
        } catch {
          if (!stream.aborted) await stream.writeSSE({ event: 'ended', data: JSON.stringify({ reason: 'Run access ended; review authorization before reconnecting' }) }).catch(() => {});
        } finally {
          stop(); clearTimeout(timer); wake = undefined;
          const count = (subscriptions.get(extensionId) ?? 1) - 1;
          if (count) subscriptions.set(extensionId, count); else subscriptions.delete(extensionId);
        }
      });
    } catch (error) { return capabilityHttpError(c, error); }
  });
}
