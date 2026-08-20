// ── Phase identifiers ──────────────────────────────────────────────────

export type DreamingPhaseId = 'light' | 'deep' | 'rem';
export const DREAMING_ALGORITHM_VERSION = 'structured-v1';

export const DREAMING_PHASES: readonly DreamingPhaseId[] = ['light', 'deep', 'rem'] as const;

// ── Sweep tokens (used in automation payloads to trigger each phase) ──

export const DREAMING_SWEEP_TOKEN = '__xopc_memory_dreaming_sweep__';
export const DREAMING_LIGHT_SWEEP_TOKEN = '__xopc_memory_dreaming_light_sweep__';
export const DREAMING_REM_SWEEP_TOKEN = '__xopc_memory_dreaming_rem_sweep__';

// ── Managed automation metadata ───────────────────────────────────────

export const DREAMING_AUTOMATION_TAG = '[managed-by=xopc.memory.dreaming]';

export const DREAMING_DEEP_AUTOMATION_NAME = 'Memory Dreaming - Deep Promotion';
export const DREAMING_LIGHT_AUTOMATION_NAME = 'Memory Dreaming - Light Sweep';
export const DREAMING_REM_AUTOMATION_NAME = 'Memory Dreaming - REM Patterns';

// ── Time-decay defaults ────────────────────────────────────────────────

export const DEFAULT_RECENCY_HALF_LIFE_DAYS = 14;
export const DEFAULT_MAX_AGE_DAYS = 30;
