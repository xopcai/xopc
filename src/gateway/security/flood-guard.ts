/**
 * Unauthorized flood guard for WebSocket connections.
 *
 * Tracks repeated unauthorized message attempts on a single WS connection
 * and decides when to forcibly close it. Prevents a rogue client from
 * holding a socket open and spamming unauthorized requests.
 */

export type FloodGuardOptions = {
  /** Close the connection after this many unauthorized messages. @default 10 */
  closeAfter?: number;
  /** Log every N unauthorized messages to prevent log spam. @default 100 */
  logEvery?: number;
};

export type FloodGuardDecision = {
  shouldClose: boolean;
  shouldLog: boolean;
  count: number;
  suppressedSinceLastLog: number;
};

const DEFAULT_CLOSE_AFTER = 10;
const DEFAULT_LOG_EVERY = 100;

export class UnauthorizedFloodGuard {
  private readonly closeAfter: number;
  private readonly logEvery: number;
  private count = 0;
  private suppressedSinceLastLog = 0;

  constructor(options?: FloodGuardOptions) {
    this.closeAfter = Math.max(1, Math.floor(options?.closeAfter ?? DEFAULT_CLOSE_AFTER));
    this.logEvery = Math.max(1, Math.floor(options?.logEvery ?? DEFAULT_LOG_EVERY));
  }

  registerUnauthorized(): FloodGuardDecision {
    this.count += 1;
    const shouldClose = this.count > this.closeAfter;
    const shouldLog = this.count === 1 || this.count % this.logEvery === 0 || shouldClose;

    if (!shouldLog) {
      this.suppressedSinceLastLog += 1;
      return {
        shouldClose,
        shouldLog: false,
        count: this.count,
        suppressedSinceLastLog: 0,
      };
    }

    const suppressedSinceLastLog = this.suppressedSinceLastLog;
    this.suppressedSinceLastLog = 0;
    return {
      shouldClose,
      shouldLog: true,
      count: this.count,
      suppressedSinceLastLog,
    };
  }

  reset(): void {
    this.count = 0;
    this.suppressedSinceLastLog = 0;
  }
}
