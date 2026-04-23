import { existsSync, mkdirSync, chmodSync, accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckResult, DoctorContext } from '../types.js';

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkStateIntegrity(ctx: DoctorContext): Promise<CheckResult> {
  const root = ctx.stateDir;
  const hints: string[] = [];

  if (!existsSync(root)) {
    if (ctx.options.fix) {
      try {
        mkdirSync(root, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') {
          chmodSync(root, 0o700);
        }
        return {
          id: 'state-integrity',
          label: 'State directory',
          status: 'pass',
          message: 'Created state directory with safe permissions.',
          hints: [root],
          fixed: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          id: 'state-integrity',
          label: 'State directory',
          status: 'fail',
          message: `State directory missing and could not create: ${msg}`,
          hints: [root],
        };
      }
    }
    return {
      id: 'state-integrity',
      label: 'State directory',
      status: 'fail',
      message: 'State directory does not exist.',
      hints: [`Expected: ${root}`, 'Run: xopc init', 'Or: xopc doctor --fix'],
    };
  }

  if (!isWritable(root)) {
    return {
      id: 'state-integrity',
      label: 'State directory',
      status: 'fail',
      message: 'State directory is not writable.',
      hints: [root],
    };
  }

  if (process.platform !== 'win32') {
    try {
      const mode = statSync(root).mode & 0o777;
      if (mode !== 0o700) {
        if (ctx.options.fix) {
          chmodSync(root, 0o700);
          return {
            id: 'state-integrity',
            label: 'State directory',
            status: 'pass',
            message: 'State directory permissions set to 700.',
            hints: [root],
            fixed: true,
          };
        }
        return {
          id: 'state-integrity',
          label: 'State directory',
          status: 'warn',
          message: 'State directory permissions are not 700 (recommended for privacy).',
          hints: [root, 'Run: xopc doctor --fix'],
        };
      }
    } catch {
      /* ignore stat errors */
    }
  }

  const agentsDir = join(root, 'agents');
  if (!existsSync(agentsDir) && ctx.options.fix) {
    try {
      mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
      hints.push(`Created: ${agentsDir}`);
    } catch {
      /* best-effort */
    }
  }

  return {
    id: 'state-integrity',
    label: 'State directory',
    status: 'pass',
    message: 'State directory exists and is usable.',
    hints: hints.length ? hints : [root],
  };
}
