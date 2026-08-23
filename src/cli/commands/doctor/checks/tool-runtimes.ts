import { loadConfig } from '../../../../config/loader.js';
import { ManagedRuntimeManager } from '../../../../runtime-tools/manager.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkToolRuntimes(ctx: DoctorContext): Promise<CheckResult> {
  const config = loadConfig(ctx.configPath);
  const statuses = await new ManagedRuntimeManager({
    stateDir: ctx.stateDir,
    config: config.runtimeTools,
  }).statusAll();
  const invalid = statuses.filter((status) => status.state === 'corrupted' || status.state === 'failed');
  const absent = statuses.filter((status) => status.state === 'absent');
  if (invalid.length > 0) {
    return {
      id: 'tool-runtimes',
      label: 'Agent tool runtimes',
      status: 'fail',
      message: `${invalid.map((status) => status.runtime).join(', ')} runtime installation is invalid.`,
      hints: invalid.map((status) => `Run xopc runtime repair ${status.runtime}`),
    };
  }
  if (absent.length > 0) {
    return {
      id: 'tool-runtimes',
      label: 'Agent tool runtimes',
      status: 'warn',
      message: `${absent.map((status) => status.runtime).join(', ')} runtime is not installed.`,
      hints: absent.map((status) => `Run xopc runtime install ${status.runtime}`),
    };
  }
  return {
    id: 'tool-runtimes',
    label: 'Agent tool runtimes',
    status: 'pass',
    message: statuses.map((status) => status.message).join('; '),
    hints: [],
  };
}
