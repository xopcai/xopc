import { randomBytes } from 'node:crypto';

import { getDevice } from '../../storage/sqlite/device-access-repository.js';
import type { GatewayPrincipal } from './gateway-principal.js';
import { hasGatewayScope, isMediaPlaybackPath, requiredGatewayScope } from './gateway-scopes.js';

// Native players make their own metadata and seek requests, so a grant is reusable for one media URL.
const TICKET_TTL_MS = 2 * 60 * 60_000;
const MAX_TICKETS = 2048;
const tickets = new Map<string, { path: string; deviceId: string; expiresAt: number }>();

export function issueMediaPlaybackTicket(path: string, principal: GatewayPrincipal): string | undefined {
  if (!isMediaPlaybackPath(path)) return;
  const scope = requiredGatewayScope('GET', path);
  if (principal.kind !== 'device' || !principal.deviceId || !scope || !hasGatewayScope(principal.scopes, scope)) return;
  const now = Date.now();
  for (const [ticket, grant] of tickets) {
    if (grant.expiresAt > now) break;
    tickets.delete(ticket);
  }
  if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { path, deviceId: principal.deviceId, expiresAt: now + TICKET_TTL_MS });
  return `${path}?playbackTicket=${ticket}`;
}

export function authenticateMediaPlaybackTicket(url: URL, method: string): GatewayPrincipal | undefined {
  if ((method !== 'GET' && method !== 'HEAD') || url.searchParams.size !== 1) return;
  const ticket = url.searchParams.get('playbackTicket');
  const grant = ticket && tickets.get(ticket);
  if (!grant || grant.path !== url.pathname || grant.expiresAt <= Date.now()) return;
  const device = getDevice(grant.deviceId);
  if (!device || device.revokedAt !== undefined) return;
  return { kind: 'device', deviceId: device.id, principalId: device.id, scopes: device.scopes };
}
