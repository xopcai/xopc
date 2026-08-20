// ── Phase identifiers ──────────────────────────────────────────────────

export type DreamingPhaseId = 'light' | 'deep' | 'rem';
export const DREAMING_ALGORITHM_VERSION = 'structured-v1';

export const DREAMING_PHASES: readonly DreamingPhaseId[] = ['light', 'deep', 'rem'] as const;

// ── Sweep tokens (used in cron payloads to trigger each phase) ─────────

export const DREAMING_SWEEP_TOKEN = '__xopc_memory_dreaming_sweep__';
export const DREAMING_LIGHT_SWEEP_TOKEN = '__xopc_memory_dreaming_light_sweep__';
export const DREAMING_REM_SWEEP_TOKEN = '__xopc_memory_dreaming_rem_sweep__';

// ── Cron job metadata ──────────────────────────────────────────────────

export const DREAMING_CRON_TAG = '[managed-by=xopc.memory.dreaming]';

export const DREAMING_CRON_NAME = 'Memory Dreaming - Deep Promotion';
export const DREAMING_LIGHT_CRON_NAME = 'Memory Dreaming - Light Sweep';
export const DREAMING_REM_CRON_NAME = 'Memory Dreaming - REM Patterns';

// ── Default cron schedules ─────────────────────────────────────────────

export const DEFAULT_DEEP_CRON = '0 3 * * *';
export const DEFAULT_LIGHT_CRON = '0 */6 * * *';
export const DEFAULT_REM_CRON = '0 5 * * 0';

// ── Time-decay defaults ────────────────────────────────────────────────

export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 14;
export const DEFAULT_MAX_AGE_DAYS = 30;
