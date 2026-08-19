import { colors } from '../../utils/colors.js';
import type { SetupTask } from './types.js';

/**
 * Single-line JSON for `--json` mode. Agents (M2) parse stdout, so we keep
 * this stable: `{ ok, action, domain, target?, changedPaths, dryRun, errors?,
 * value?, notes? }`.
 */
export function printJsonTask(task: SetupTask): void {
  const payload: Record<string, unknown> = {
    ok: task.ok,
    action: task.action,
    domain: task.domain,
    changedPaths: task.changedPaths,
    dryRun: task.dryRun,
  };
  if (task.target !== undefined) payload.target = task.target;
  if (task.errors?.length) payload.errors = task.errors;
  if (task.value !== undefined) payload.value = task.value;
  if (task.notes?.length) payload.notes = task.notes;
  process.stdout.write(JSON.stringify(payload) + '\n');
}

const ACTION_VERB: Record<SetupTask['action'], string> = {
  add: 'Added',
  set: 'Updated',
  remove: 'Removed',
  noop: 'No change',
};

export function printTextTask(task: SetupTask): void {
  if (!task.ok) {
    console.error(colors.red('✗') + ' ' + colors.bold(`${task.domain} ${task.action}`) + ' failed');
    for (const err of task.errors ?? []) {
      const where = err.path ? colors.gray(`[${err.path}] `) : '';
      console.error(`  ${where}${err.message}`);
    }
    return;
  }

  const target = task.target ? ` ${colors.bold(task.target)}` : '';
  const verb = ACTION_VERB[task.action];
  const dryRun = task.dryRun ? colors.yellow(' [dry-run]') : '';
  console.log(colors.green('✓') + ` ${verb} ${task.domain}${target}${dryRun}`);

  if (task.changedPaths.length > 0) {
    console.log(colors.gray('  Changed paths:'));
    for (const path of task.changedPaths) {
      console.log(`    ${colors.cyan(path)}`);
    }
  } else if (task.action === 'noop') {
    console.log(colors.gray('  Nothing to change.'));
  }

  for (const note of task.notes ?? []) {
    console.log(`  ${colors.gray('→')} ${note}`);
  }
}

export function emitTask(task: SetupTask, json: boolean): void {
  if (json) {
    printJsonTask(task);
  } else {
    printTextTask(task);
  }
}
