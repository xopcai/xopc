/**
 * Single source of truth for gateway probe timing. Hooks, the health monitor,
 * and the race strategy all read from here so the system's overall behaviour
 * stays predictable when one constant moves.
 *
 * Rules of thumb:
 *   - LAN probes must be aggressive (1.5s) — a healthy LAN gateway answers
 *     well under 200ms; if 1.5s isn't enough we're not on its network.
 *   - Tunnel probes go through public infra; allow more headroom (3.5s).
 *   - Cool-downs prevent a foreground tick + a focus tick + a network tick
 *     from all firing the same probe within milliseconds of each other.
 */
export type ProbeTiming = {
  TIMEOUT_LAN_MS: number;
  TIMEOUT_TUNNEL_MS: number;
  /** Window during which a finished tunnel probe waits for LAN to respond. */
  LAN_HEAD_START_MS: number;
  /** Wallclock cap on the whole race — never block longer than this. */
  RACE_HARD_TIMEOUT_MS: number;
  /** Health monitor periodic poll interval. */
  HEALTH_POLL_MS: number;
  /** Foreground "is my route still the best?" interval. */
  FOREGROUND_RECHECK_MS: number;
  /** Don't re-probe more often than this on user-driven triggers. */
  RECHECK_COOLDOWN_MS: number;
  /** Single health-check fetch timeout used by GatewayHealthMonitor.checkNow. */
  HEALTH_CHECK_TIMEOUT_MS: number;
};

export const PROBE_TIMING: ProbeTiming = {
  TIMEOUT_LAN_MS: 1_500,
  TIMEOUT_TUNNEL_MS: 2_500,
  LAN_HEAD_START_MS: 200,
  RACE_HARD_TIMEOUT_MS: 2_500,
  HEALTH_POLL_MS: 60_000,
  FOREGROUND_RECHECK_MS: 60_000,
  RECHECK_COOLDOWN_MS: 5_000,
  HEALTH_CHECK_TIMEOUT_MS: 3_000,
};
