import crypto from 'node:crypto';

import type { RealtimeClientKind } from '@xopcai/realtime-protocol';
import type { GatewayScope } from '../gateway/security/gateway-scopes.js';

const TICKET_TTL_MS = 30_000;
const MAX_OUTSTANDING_TICKETS = 1_000;

export interface RealtimeTicketClaim {
  clientId: string;
  clientKind: RealtimeClientKind;
  principalId: string;
  deviceId?: string;
  accessSessionId?: string;
  scopes: readonly GatewayScope[];
  expiresAt: number;
}

export interface IssuedRealtimeTicket extends RealtimeTicketClaim {
  ticket: string;
}

function ticketKey(ticket: string): string {
  return crypto.createHash('sha256').update(ticket).digest('hex');
}

export class RealtimeTicketStore {
  private readonly claims = new Map<string, RealtimeTicketClaim>();

  issue(
    clientId: string,
    clientKind: RealtimeClientKind,
    principal: Omit<RealtimeTicketClaim, 'clientId' | 'clientKind' | 'expiresAt'>,
    now = Date.now(),
  ): IssuedRealtimeTicket {
    this.prune(now);
    if (this.claims.size >= MAX_OUTSTANDING_TICKETS) {
      throw new Error('Too many outstanding realtime tickets');
    }
    const ticket = crypto.randomBytes(32).toString('base64url');
    const claim = { clientId, clientKind, ...principal, expiresAt: now + TICKET_TTL_MS };
    this.claims.set(ticketKey(ticket), claim);
    return { ticket, ...claim };
  }

  consume(
    ticket: string,
    clientId: string,
    clientKind: RealtimeClientKind,
    now = Date.now(),
  ): RealtimeTicketClaim | undefined {
    const key = ticketKey(ticket);
    const claim = this.claims.get(key);
    this.claims.delete(key);
    if (!claim || claim.expiresAt < now) return undefined;
    if (claim.clientId !== clientId || claim.clientKind !== clientKind) return undefined;
    return claim;
  }

  private prune(now: number): void {
    for (const [key, claim] of this.claims) {
      if (claim.expiresAt < now) this.claims.delete(key);
    }
  }
}
