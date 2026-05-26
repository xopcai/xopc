import { colors } from '../../utils/colors.js';
import type { SetupOutcome } from './types.js';

/**
 * Single-line JSON for `--json` mode. Agents (M2) parse stdout, so we keep
 * this stable: `{ ok, action, domain, target?, changedPaths, dryRun, errors?,
 * value?, notes? }`.
 */
export function printJsonOutcome(outcome: SetupOutcome): void {
  const payload: Record<string, unknown> = {
    ok: outcome.ok,
    action: outcome.action,
    domain: outcome.domain,
    changedPaths: outcome.changedPaths,
    dryRun: outcome.dryRun,
  };
  if (outcome.target !== undefined) payload.target = outcome.target;
  if (outcome.errors?.length) payload.errors = outcome.errors;
  if (outcome.value !== undefined) payload.value = outcome.value;
  if (outcome.notes?.length) payload.notes = outcome.notes;
  process.stdout.write(JSON.stringify(payload) + '\n');
}

const ACTION_VERB: Record<SetupOutcome['action'], string> = {
  add: 'Added',
  set: 'Updated',
  remove: 'Removed',
  noop: 'No change',
};

export function printTextOutcome(outcome: SetupOutcome): void {
  if (!outcome.ok) {
    console.error(colors.red('✗') + ' ' + colors.bold(`${outcome.domain} ${outcome.action}`) + ' failed');
    for (const err of outcome.errors ?? []) {
      const where = err.path ? colors.gray(`[${err.path}] `) : '';
      console.error(`  ${where}${err.message}`);
    }
    return;
  }

  const target = outcome.target ? ` ${colors.bold(outcome.target)}` : '';
  const verb = ACTION_VERB[outcome.action];
  const dryRun = outcome.dryRun ? colors.yellow(' [dry-run]') : '';
  console.log(colors.green('✓') + ` ${verb} ${outcome.domain}${target}${dryRun}`);

  if (outcome.changedPaths.length > 0) {
    console.log(colors.gray('  Changed paths:'));
    for (const path of outcome.changedPaths) {
      console.log(`    ${colors.cyan(path)}`);
    }
  } else if (outcome.action === 'noop') {
    console.log(colors.gray('  Nothing to change.'));
  }

  for (const note of outcome.notes ?? []) {
    console.log(`  ${colors.gray('→')} ${note}`);
  }
}

export function emitOutcome(outcome: SetupOutcome, json: boolean): void {
  if (json) {
    printJsonOutcome(outcome);
  } else {
    printTextOutcome(outcome);
  }
}
