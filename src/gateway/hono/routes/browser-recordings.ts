import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

import { BrowserRecordingService } from '../../../browser/recordings/service.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function recordingAvailability(deps: AuthenticatedRouteDeps, deviceId?: string) {
  const browsers = deps.service.endpointTools.registry.list().filter((endpoint) => endpoint.kind === 'browser'
    && (!deviceId || endpoint.principalId === deviceId));
  const endpoints = browsers.filter((endpoint) => endpoint.tools.some((tool) => tool.descriptor.name === 'browser.recording'))
    .map(({ endpointId, displayName }) => ({ endpointId, displayName }));
  const state = endpoints.length > 1 ? 'choose_browser' : endpoints.length === 1 ? 'ready'
    : browsers.length ? 'update_required' : 'connect_required';
  return { state, endpoints };
}

export function registerBrowserRecordingRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const service = new BrowserRecordingService(deps.service.browserAutomations);
  app.get('/api/browser/recordings/availability', (c) => {
    const principal = getGatewayPrincipal(c);
    return c.json(recordingAvailability(deps, principal.kind === 'device' ? principal.deviceId : undefined));
  });
  app.post('/api/browser/recordings/control', async (c) => {
    try {
      const body = await c.req.json();
      if (!['start', 'pause', 'resume', 'finish', 'status'].includes(body.operation)) return c.json({ error: 'Invalid recording operation.' }, 400);
      const principal = getGatewayPrincipal(c);
      const endpoints = deps.service.endpointTools.registry.list().filter((endpoint) => endpoint.kind === 'browser'
        && (principal.kind !== 'device' || endpoint.principalId === principal.deviceId)
        && (!body.endpointId || endpoint.endpointId === body.endpointId)
        && endpoint.tools.some((tool) => tool.descriptor.name === 'browser.recording'));
      if (endpoints.length !== 1) {
        const availability = recordingAvailability(deps, principal.kind === 'device' ? principal.deviceId : undefined);
        return c.json({ code: availability.state === 'ready' ? 'connect_required' : availability.state,
          error: 'Recording requires a connected browser with recording support.', endpoints: availability.endpoints }, 409);
      }
      const endpoint = endpoints[0]!;
      const tool = deps.service.endpointTools.registry.getTool(endpoint.endpointId, 'browser.recording')!;
      const result = await deps.service.endpointTools.invocations.invoke({ endpointId: endpoint.endpointId, toolCallId: `recording:${randomUUID()}`,
        toolName: 'browser.recording', arguments: { operation: body.operation }, descriptorRevision: tool.revision, signal: AbortSignal.timeout(30_000) });
      return c.json({ value: result.content.find((item) => item.type === 'json')?.value, endpointId: endpoint.endpointId });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post('/api/browser/recordings/:id/:operation{events|finish}', async (c) => {
    const principal = getGatewayPrincipal(c);
    const endpointId = c.req.header('x-endpoint-id') ?? '';
    const claim = c.req.header('x-endpoint-claim') ?? '';
    const endpoint = deps.service.endpointTools.registry.get(endpointId);
    if (principal.kind !== 'device' || !principal.deviceId || endpoint?.principalId !== principal.deviceId
      || !deps.service.endpointTools.registry.verifyTurnClaim(endpointId, claim)) return c.json({ error: 'Recording device is not authenticated.' }, 403);
    try {
      if (Number(c.req.header('content-length') ?? 0) > 262144) return c.json({ error: 'Recording batch is too large.' }, 413);
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 262144) return c.json({ error: 'Recording batch is too large.' }, 413);
      const body = JSON.parse(raw);
      return c.req.param('operation') === 'events'
        ? c.json(service.append(c.req.param('id'), principal.deviceId, body.events))
        : c.json({ automation: service.finish(c.req.param('id'), principal.deviceId, body.finalSeq) });
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
