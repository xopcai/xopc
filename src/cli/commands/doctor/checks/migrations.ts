import { applyMigrations, detectMigrations } from '../../../../migrations/runner.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkMigrations(ctx: DoctorContext): Promise<CheckResult> {
  const planned = detectMigrations(ctx.configPath, { stateDir: ctx.stateDir });
  if (planned.length === 0) {
    return {
      id: 'migrations',
      label: 'Migrations',
      status: 'pass',
      message: 'No pending migrations.',
      hints: [ctx.configPath],
    };
  }

  if (ctx.options.fix) {
    const result = applyMigrations(ctx.configPath, { stateDir: ctx.stateDir, mode: 'doctor-fix' });
    const blocking = result.items.filter((item) => item.status === 'conflict' || item.status === 'error');
    const applied = result.items.filter((item) => item.status === 'applied');
    return {
      id: 'migrations',
      label: 'Migrations',
      status: blocking.length > 0 ? 'fail' : 'pass',
      message: blocking.length > 0
        ? `${applied.length} migration(s) applied; ${blocking.length} need manual attention.`
        : `${applied.length} migration(s) applied.`,
      hints: result.items.map((item) => `${item.id}: ${item.message}`),
      fixed: applied.length > 0,
    };
  }

  const conflicts = planned.filter((item) => item.status === 'conflict' || item.status === 'error');
  return {
    id: 'migrations',
    label: 'Migrations',
    status: conflicts.length > 0 ? 'fail' : 'warn',
    message: conflicts.length > 0
      ? `${planned.length} migration(s) pending; ${conflicts.length} need manual attention.`
      : `${planned.length} safe migration(s) pending.`,
    hints: ['Run: xopc doctor --fix', ...planned.map((item) => `${item.id}: ${item.message}`)],
  };
}
