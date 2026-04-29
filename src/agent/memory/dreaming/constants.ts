import path from 'node:path';

// ── Phase identifiers ──────────────────────────────────────────────────

export type DreamingPhaseId = 'light' | 'deep' | 'rem';

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

// ── Scoring weights ────────────────────────────────────────────────────

/** Milliseconds in one day (used for time-decay calculations). */
export const MS_PER_DAY = 86_400_000;

/** Weight applied to recall-count reinforcement (logarithmic boost). */
export const REINFORCEMENT_WEIGHT = 0.12;

/** Weight applied to signal-diversity bonus. */
export const DIVERSITY_WEIGHT = 0.08;

/** Number of signal dimensions used for diversity calculation. */
export const DIVERSITY_DIMENSION_COUNT = 4;

// ── File paths ─────────────────────────────────────────────────────────

export const DREAMING_DIR_RELATIVE = path.join('memory', '.dreams');
export const SHORT_TERM_RECALL_STORE_RELATIVE = path.join(DREAMING_DIR_RELATIVE, 'short-term-recall.json');
export const SHORT_TERM_PROMOTION_LOCK_RELATIVE = path.join(
  DREAMING_DIR_RELATIVE,
  'short-term-promotion.lock',
);
export const DREAMING_LAST_RUN_RELATIVE = path.join(DREAMING_DIR_RELATIVE, 'last-run.json');
export const DREAMING_EVENTS_LOG_RELATIVE = path.join(DREAMING_DIR_RELATIVE, 'events.jsonl');

export const MEMORY_MD_FILENAME = 'MEMORY.md';
export const DREAMS_MD_FILENAME = 'DREAMS.md';

