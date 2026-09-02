/**
 * Typed errors for gateway connectivity. The UI maps these to specific copy
 * + actions instead of showing one generic "could not reach gateway" message.
 *
 * `kind` answers "what does the user need to do?":
 *   - 'offline-network'        → user has no internet (airplane / Wi-Fi off)
 *   - 'no-route'               → every paired HTTPS route timed out
 *   - 'token-invalid'          → 401 (re-pair)
 *   - 'misconfigured'          → no valid paired gateway route
 *   - 'unknown'                → fallback
 */
export type GatewayErrorKind =
  | 'offline-network'
  | 'no-route'
  | 'token-invalid'
  | 'misconfigured'
  | 'unknown';

export class GatewayConnectivityError extends Error {
  readonly kind: GatewayErrorKind;
  readonly httpStatus?: number;
  /** Original underlying error if any (network failure, abort, etc.). */
  readonly cause?: unknown;

  constructor(
    kind: GatewayErrorKind,
    message: string,
    options: {
      httpStatus?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'GatewayConnectivityError';
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.cause = options.cause;
  }
}

export function isGatewayConnectivityError(err: unknown): err is GatewayConnectivityError {
  return err instanceof GatewayConnectivityError;
}
