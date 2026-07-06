/**
 * Typed errors for gateway connectivity. The UI maps these to specific copy
 * + actions instead of showing one generic "could not reach gateway" message.
 *
 * `kind` answers "what does the user need to do?":
 *   - 'offline-network'        → user has no internet (airplane / Wi-Fi off)
 *   - 'offline-device'         → tunnel works, LAN refused / 502 / 5xx → their
 *                                gateway computer is asleep or off
 *   - 'no-route'               → both routes timed out
 *   - 'reverse-proxy-unreachable' → HTTPS baseUrl (user reverse proxy) didn't
 *                                respond — likely TLS / DNS / proxy misroute.
 *                                More actionable than `no-route` because the
 *                                user needs to check their nginx/Caddy config.
 *   - 'token-invalid'          → 401 (re-pair)
 *   - 'misconfigured'          → URL invalid / not an xopc gateway
 *   - 'server-error'           → 5xx on a known route
 *   - 'unknown'                → fallback
 */
export type GatewayErrorKind =
  | 'offline-network'
  | 'offline-device'
  | 'no-route'
  | 'reverse-proxy-unreachable'
  | 'token-invalid'
  | 'misconfigured'
  | 'server-error'
  | 'unknown';

export class GatewayConnectivityError extends Error {
  readonly kind: GatewayErrorKind;
  readonly httpStatus?: number;
  readonly lanFailed?: boolean;
  readonly tunnelFailed?: boolean;
  /** Original underlying error if any (network failure, abort, etc.). */
  readonly cause?: unknown;

  constructor(
    kind: GatewayErrorKind,
    message: string,
    options: {
      httpStatus?: number;
      lanFailed?: boolean;
      tunnelFailed?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'GatewayConnectivityError';
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.lanFailed = options.lanFailed;
    this.tunnelFailed = options.tunnelFailed;
    this.cause = options.cause;
  }
}

export function isGatewayConnectivityError(err: unknown): err is GatewayConnectivityError {
  return err instanceof GatewayConnectivityError;
}
