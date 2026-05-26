import { ZodError } from 'zod';

import { loadConfig, saveConfig } from '../../../config/index.js';
import { ConfigSchema, type Config } from '../../../config/schema.js';
import { diffConfigPaths } from '../../../config/diff.js';

import { emitOutcome } from './output.js';
import { isPromptCancelled } from './prompts.js';
import {
  SETUP_EXIT,
  type SetupAction,
  type SetupError,
  type SetupOutcome,
  type SetupRunOptions,
} from './types.js';

/** Thrown by a {@link SetupMutator.mutate} to fail the run with a clean message. */
export class SetupValidationError extends Error {
  readonly errors: SetupError[];

  constructor(errors: SetupError[] | SetupError | string) {
    const list: SetupError[] = Array.isArray(errors)
      ? errors
      : typeof errors === 'string'
        ? [{ message: errors }]
        : [errors];
    super(list.map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message)).join('; '));
    this.name = 'SetupValidationError';
    this.errors = list;
  }
}

export interface SetupMutator {
  /** Logical domain — `providers`, `channels.telegram`, etc. */
  domain: string;
  /** Target id within the domain (provider id, account id, …). */
  target?: string;
  /** What the operation is conceptually doing. */
  action: SetupAction;
  /** Mutates `config` in place (or returns a replacement) and returns it. */
  mutate(config: Config): Config | Promise<Config>;
  /** Optional masked value to surface in the outcome (for agents / UI). */
  resultValue?(config: Config): unknown;
  /** Optional human-readable notes appended to the outcome. */
  notes?(config: Config): string[];
}

export interface RunSetupArgs {
  configPath: string;
  mutator: SetupMutator;
  options: SetupRunOptions;
}

function zodErrorToSetupErrors(err: ZodError): SetupError[] {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Headless setup pipeline — load → clone → mutate → validate(zod) → diff →
 * (write | dry-run) → outcome. Returns the {@link SetupOutcome} without any
 * I/O side effects (no stdout, no `process.exitCode`).
 *
 * Used by the gateway HTTP route (`/api/setup/*`, M3.5) and by the CLI
 * wrapper {@link runSetup}. Keep this side-effect-free so it stays safe to
 * call from web/server contexts and from tests.
 *
 * Custom errors thrown by the mutator surface as `errors[]` on the outcome:
 *   - `SetupValidationError` — explicit `{path?, message}[]` entries
 *   - `ExitPromptError` (from `@inquirer/prompts`) — surfaced as "Cancelled by user"
 *   - any other `Error` — the message is used verbatim
 */
export async function runSetupHeadless(args: RunSetupArgs): Promise<SetupOutcome> {
  const { configPath, mutator, options } = args;

  let before: Config;
  try {
    before = loadConfig(configPath);
  } catch (error) {
    return {
      ok: false,
      action: mutator.action,
      domain: mutator.domain,
      target: mutator.target,
      changedPaths: [],
      dryRun: options.dryRun,
      errors: [{ message: `Failed to load config: ${(error as Error).message}` }],
    };
  }

  // `loadConfig` parses through the schema once, but the schema isn't fully
  // idempotent — re-parsing a result can fill in deeper defaults that the
  // first pass left undefined. To avoid false-positive diffs against those
  // defaults, normalize both sides through one extra parse cycle.
  const baselineParsed = ConfigSchema.safeParse(structuredClone(before));
  const baseline: Config = baselineParsed.success ? baselineParsed.data : before;

  const cloneBefore = structuredClone(before);
  let mutated: Config;
  try {
    mutated = await mutator.mutate(cloneBefore);
  } catch (error) {
    if (isPromptCancelled(error)) {
      return {
        ok: false,
        action: mutator.action,
        domain: mutator.domain,
        target: mutator.target,
        changedPaths: [],
        dryRun: options.dryRun,
        errors: [{ message: 'Cancelled by user' }],
      };
    }
    const errors =
      error instanceof SetupValidationError
        ? error.errors
        : [{ message: (error as Error).message }];
    return {
      ok: false,
      action: mutator.action,
      domain: mutator.domain,
      target: mutator.target,
      changedPaths: [],
      dryRun: options.dryRun,
      errors,
    };
  }

  // Validate the full config (catches invariants beyond the mutator's scope).
  const parsed = ConfigSchema.safeParse(mutated);
  if (!parsed.success) {
    return {
      ok: false,
      action: mutator.action,
      domain: mutator.domain,
      target: mutator.target,
      changedPaths: [],
      dryRun: options.dryRun,
      errors: zodErrorToSetupErrors(parsed.error),
    };
  }
  const validated = parsed.data;

  const changedPaths = diffConfigPaths(baseline, validated);
  const action: SetupAction = changedPaths.length === 0 ? 'noop' : mutator.action;

  if (changedPaths.length > 0 && !options.dryRun) {
    try {
      await saveConfig(validated, configPath);
    } catch (error) {
      return {
        ok: false,
        action: mutator.action,
        domain: mutator.domain,
        target: mutator.target,
        changedPaths,
        dryRun: false,
        errors: [{ message: `Failed to save config: ${(error as Error).message}` }],
      };
    }
  }

  return {
    ok: true,
    action,
    domain: mutator.domain,
    target: mutator.target,
    changedPaths,
    dryRun: options.dryRun,
    value: mutator.resultValue?.(validated),
    notes: mutator.notes?.(validated),
  };
}

/**
 * CLI wrapper around {@link runSetupHeadless}: emits the outcome to stdout
 * (text or single-line JSON) and sets `process.exitCode` to the standard
 * setup exit codes (0 ok / 1 error / 2 cancelled).
 *
 * Use this from CLI command actions; use {@link runSetupHeadless} from any
 * non-CLI caller (HTTP routes, library code, tests).
 */
export async function runSetup(args: RunSetupArgs): Promise<SetupOutcome> {
  const outcome = await runSetupHeadless(args);
  emitOutcome(outcome, args.options.json);
  if (outcome.ok) {
    process.exitCode = SETUP_EXIT.OK;
  } else if (outcome.errors?.some((e) => /cancelled/i.test(e.message))) {
    process.exitCode = SETUP_EXIT.CANCELLED;
  } else {
    process.exitCode = SETUP_EXIT.ERROR;
  }
  return outcome;
}
