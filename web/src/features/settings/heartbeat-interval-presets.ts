/** Preset heartbeat intervals (ms). Must match gateway `intervalMs`. */
export const HEARTBEAT_INTERVAL_PRESET_MS_ORDER = [
  30_000,
  60_000,
  300_000,
  600_000,
  900_000,
  1_800_000,
  3_600_000,
  7_200_000,
] as const;

export const HEARTBEAT_INTERVAL_PRESET_MS = new Set<number>(HEARTBEAT_INTERVAL_PRESET_MS_ORDER);
