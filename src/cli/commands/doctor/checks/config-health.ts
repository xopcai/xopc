import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import { loadConfig, saveConfig } from '../../../../config/loader.js';
import { ConfigSchema } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkConfigHealth(ctx: DoctorContext): Promise<CheckResult> {
  const path = ctx.configPath;

  if (!existsSync(path)) {
    if (ctx.options.fix) {
      try {
        const dir = dirname(path);
        mkdirSync(dir, { recursive: true });
        const defaults = loadConfig(path);
        await saveConfig(defaults, path);
        return {
          id: 'config-health',
          label: 'Config',
          status: 'pass',
          message: 'Created default config file.',
          hints: [path],
          fixed: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          id: 'config-health',
          label: 'Config',
          status: 'fail',
          message: `Config file missing and could not create default: ${msg}`,
          hints: [path],
        };
      }
    }
    return {
      id: 'config-health',
      label: 'Config',
      status: 'fail',
      message: 'Config file not found.',
      hints: [`Run: xopc init`, `Or: xopc doctor --fix`],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: 'config-health',
      label: 'Config',
      status: 'fail',
      message: `Cannot read config file: ${msg}`,
      hints: [path],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      id: 'config-health',
      label: 'Config',
      status: 'fail',
      message: 'Config file is not valid JSON.',
      hints: ['Fix syntax or restore from backup (.bak).', path],
    };
  }

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    return {
      id: 'config-health',
      label: 'Config',
      status: 'fail',
      message: 'Config does not match the expected schema.',
      hints: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  return {
    id: 'config-health',
    label: 'Config',
    status: 'pass',
    message: 'Config file exists and validates.',
    hints: [path],
  };
}
