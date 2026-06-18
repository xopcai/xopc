/**
 * Shared types for `xopc <domain>` setup-style commands (providers / channels / ...).
 *
 * Every setup command runs the same load → mutate → validate → diff → write
 * pipeline, and emits the same structured outcome so agents (M2 skills) and the
 * WebUI (M3) can consume results uniformly.
 */

export type SetupAction = 'add' | 'set' | 'remove' | 'noop';

export interface SetupError {
  /** Dot path of the offending field, when known (e.g. `providers.openai.apiKey`). */
  path?: string;
  message: string;
}

export interface SetupOutcome {
  ok: boolean;
  action: SetupAction;
  /** Logical domain — `providers`, `channels.<id>`, etc. */
  domain: string;
  /** Specific target id within the domain (provider id, account id, etc.). */
  target?: string;
  /** Config dot paths that differ between before and after. */
  changedPaths: string[];
  /** True when run with `--dry-run`. Nothing was written. */
  dryRun: boolean;
  /** Validation / I/O errors. Empty when ok. */
  errors?: SetupError[];
  /** Resulting (masked) value of the mutated entry, for agent / UI display. */
  value?: unknown;
  /** Human-readable summary lines for text output. */
  notes?: string[];
}

export interface SetupRunOptions {
  /** When true, validate + diff but do not write. */
  dryRun: boolean;
  /** When true, emit a single JSON line on stdout and stay silent otherwise. */
  json: boolean;
}

/**
 * Standardized exit codes for setup-style commands. Set on `process.exitCode`
 * (don't call `process.exit` directly so JSON output flushes cleanly).
 */
export const SETUP_EXIT = {
  OK: 0,
  ERROR: 1,
  CANCELLED: 2,
} as const;
