import type { GatewaySseConnection } from '@/features/gateway/gateway-sse-connection';

let active: GatewaySseConnection | null = null;

export function registerGatewaySseConnection(conn: GatewaySseConnection | null): void {
  active = conn;
}

export function reconnectGatewaySse(): void {
  active?.reconnect();
}
