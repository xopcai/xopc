import { Command } from 'commander';

import { setTuiDefaultAgentConfig } from '../../commands/agents.config.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { createGatewayCredential } from '../../gateway/credential.js';
import { detectMigrations, runBootstrapMigrationsSync } from '../../migrations/runner.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function createTuiCommand(ctx: CLIContext): Command {
  const cmd = new Command('tui')
    .description('Interactive terminal UI (pi-tui)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc                                        # Open embedded TUI (default command)',
        'xopc tui                                    # Embedded mode (default)',
        'xopc tui --gateway                          # Force gateway mode',
        'XOPC_GATEWAY_PASSWORD=xxx xopc tui --url http://host:3120 --password-env XOPC_GATEWAY_PASSWORD',
        'xopc tui -s agent:main:tui-...              # Resume a session',
        'xopc tui --agent coder                      # Start with a specific agent',
        'xopc tui --set-default-agent coder          # Persist default agent for new TUI sessions',
        'xopc tui -m "Summarize my inbox"            # Send a message on launch',
      ]),
    )
    .option('--url <url>', 'Gateway URL (default: http://localhost:3120)')
    .option('--token <token>', 'Gateway bearer token')
    .option('--password-env <name>', 'Environment variable holding the gateway password')
    .option('-s, --session <key>', 'Session key to resume (omitted: start a fresh TUI session)')
    .option('--agent <id>', 'Agent id for a fresh TUI session')
    .option('--set-default-agent <id>', 'Persist default agent for new TUI sessions and exit')
    .option('-m, --message <text>', 'Send a message on launch')
    .option('--workdir <dir>', 'Workspace directory for the new TUI session')
    .option('--no-cwd', 'Do not use the launch directory as the new TUI session workspace')
    .option('--local', 'Run in embedded mode (no gateway required)')
    .option('--gateway', 'Force gateway mode even without an explicit URL or credential')
    .option('--theme <name>', 'Theme: auto, dark, light, or custom name from ~/.xopc/themes/')
    .option('--thinking <level>', 'Thinking level override')
    .action(async (options: Record<string, string | boolean | undefined>) => {
      runBootstrapMigrationsSync(ctx.configPath);
      const pendingMigrations = detectMigrations(ctx.configPath);
      if (pendingMigrations.length > 0) {
        console.warn(
          `xopc has ${pendingMigrations.length} pending migration(s). Run \`xopc doctor --fix\` or open Settings → App management.`,
        );
      }
      if (typeof options.setDefaultAgent === 'string') {
        const cfg = loadConfig(ctx.configPath);
        const result = setTuiDefaultAgentConfig(cfg, options.setDefaultAgent);
        if (result.ok === false) {
          console.error(`Error: ${result.message}`);
          process.exit(1);
        }
        await saveConfig(result.config, ctx.configPath);
        console.log(`TUI default agent set to "${result.agentId}".`);
        return;
      }
      const { runTui } = await import('../../tui/tui.js');
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
      const localMode = useLocal || !useGateway;
      await runTui({
        url: typeof options.url === 'string' ? options.url : undefined,
        credential,
        session: typeof options.session === 'string' ? options.session : undefined,
        agentId: typeof options.agent === 'string' ? options.agent : undefined,
        message: typeof options.message === 'string' ? options.message : undefined,
        workdir: typeof options.workdir === 'string' ? options.workdir : undefined,
        useStartupCwd: options.cwd !== false,
        local: localMode,
        thinking: typeof options.thinking === 'string' ? options.thinking : undefined,
        theme: typeof options.theme === 'string' ? options.theme : undefined,
      });
    });

  return cmd;
}

register({
  id: 'tui',
  name: 'tui',
  description: 'Interactive terminal UI (pi-tui)',
  factory: createTuiCommand,
  metadata: {
    category: 'runtime',
    examples: [
      'xopc',
      'xopc tui',
      'xopc tui --agent coder',
      'xopc tui --set-default-agent coder',
      'xopc tui --gateway',
      'xopc tui --url http://host:3120',
    ],
  },
});
