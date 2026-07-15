import { createGatewayCredential } from '../../gateway/credential.js';
import { detectMigrations, runBootstrapMigrationsSync } from '../../migrations/runner.js';
import type { TuiOptions } from '../../tui/tui-types.js';

export type TuiCliOptions = Record<string, string | boolean | undefined>;

export interface TuiLaunchOverrides {
  session?: string;
  openSessionPickerOnStart?: boolean;
}

export function prepareTuiStartup(configPath: string): void {
  runBootstrapMigrationsSync(configPath);
  const pendingMigrations = detectMigrations(configPath);
  if (pendingMigrations.length > 0) {
    console.warn(
      `xopc has ${pendingMigrations.length} pending migration(s). Run \`xopc doctor --fix\` or open Settings → App management.`,
    );
  }
}

export function resolveTuiOptions(
  options: TuiCliOptions,
  overrides: TuiLaunchOverrides = {},
): TuiOptions {
  const token = typeof options.token === 'string' ? options.token : undefined;
  const passwordEnv = typeof options.passwordEnv === 'string' ? options.passwordEnv.trim() : undefined;
  if (token && passwordEnv) {
    throw new Error('Use either --token or --password-env, not both.');
  }

  const password = passwordEnv ? process.env[passwordEnv] : undefined;
  if (passwordEnv && !password) {
    throw new Error(`Gateway password environment variable ${passwordEnv} is not set.`);
  }

  const credential = token
    ? createGatewayCredential('token', token)
    : createGatewayCredential('password', password);
  const useLocal = options.local === true;
  const useGateway = options.gateway === true || typeof options.url === 'string' || credential !== undefined;
  if (useLocal && useGateway) {
    console.log('`--local` and gateway flags both set. Using local mode.');
  }

  return {
    url: typeof options.url === 'string' ? options.url : undefined,
    credential,
    session: overrides.session ?? (typeof options.session === 'string' ? options.session : undefined),
    agentId: typeof options.agent === 'string' ? options.agent : undefined,
    message: typeof options.message === 'string' ? options.message : undefined,
    workdir: typeof options.workdir === 'string' ? options.workdir : undefined,
    useStartupCwd: options.cwd !== false,
    local: useLocal || !useGateway,
    thinking: typeof options.thinking === 'string' ? options.thinking : undefined,
    theme: typeof options.theme === 'string' ? options.theme : undefined,
    openSessionPickerOnStart: overrides.openSessionPickerOnStart,
  };
}

export async function runTuiFromCliOptions(
  options: TuiCliOptions,
  overrides?: TuiLaunchOverrides,
): Promise<void> {
  const { runTui } = await import('../../tui/tui.js');
  await runTui(resolveTuiOptions(options, overrides));
}
