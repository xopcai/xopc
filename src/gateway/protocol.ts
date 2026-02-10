// Gateway protocol types - Request/Response/Event format
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
}

export type GatewayMessage = GatewayRequest | GatewayResponse | GatewayEvent;

export interface GatewayConfig {
  host: string;
  port: number;
  token?: string;
  verbose?: boolean;
}

export type RequestHandler = (
  params: Record<string, unknown>,
  ctx: RequestContext
) => Promise<unknown> | AsyncGenerator<GatewayEvent, unknown, unknown>;

export interface RequestContext {
  clientId: string;
  sendEvent: (event: GatewayEvent) => void;
  isAuthenticated: boolean;
}

export function isGatewayRequest(msg: unknown): msg is GatewayRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as GatewayRequest).type === 'req' &&
    typeof (msg as GatewayRequest).id === 'string' &&
    typeof (msg as GatewayRequest).method === 'string'
  );
}

export function createResponse(
  id: string,
  payload: unknown,
  error?: { code: string; message: string }
): GatewayResponse {
  if (error) {
    return { type: 'res', id, ok: false, error };
  }
  return { type: 'res', id, ok: true, payload };
}

export function createEvent(event: string, payload: unknown): GatewayEvent {
  return { type: 'event', event, payload };
}
