export type RootHelpOption = {
  flags: string;
  description: string;
};

export type RootHelpCommand = {
  name: string;
  description: string;
};

export const ROOT_COMMAND_DESCRIPTION = 'Ultra-Lightweight Personal AI Assistant';

export const ROOT_HELP_OPTIONS: RootHelpOption[] = [
  { flags: '-V, --version', description: 'output the version number' },
  { flags: '--verbose', description: 'Enable verbose logging (default: false)' },
  { flags: '--config <path>', description: 'Config file path' },
  { flags: '--workspace <path>', description: 'Workspace directory' },
  { flags: '-h, --help', description: 'display help for command' },
];

export const ROOT_HELP_COMMANDS: RootHelpCommand[] = [
  { name: 'init [options]', description: 'Initialize xopc state directories, config, and agent workspace' },
  { name: 'setup [options]', description: 'Initialize config file and workspace directory' },
  { name: 'profile', description: 'Manage xopc state profiles (~/.xopc vs ~/.xopc-<name>)' },
  { name: 'onboard [options]', description: 'Interactive setup wizard for xopc (gateway uses schema defaults)' },
  { name: 'channels', description: 'Messaging channel configuration' },
  { name: 'auth', description: 'Manage authentication credentials' },
  { name: 'agent [options]', description: 'Chat with the AI agent' },
  { name: 'tui [options]', description: 'Interactive terminal UI (pi-tui)' },
  { name: 'tunnel', description: 'Manage FRP remote access tunnel' },
  { name: 'gateway [options]', description: 'Start the xopc gateway server' },
  { name: 'session', description: 'Session management commands' },
  { name: 'doctor [options]', description: 'Check xopc installation health and diagnose common issues' },
  { name: 'update [options]', description: 'Check for and install xopc updates' },
  { name: 'logs', description: 'Manage and query logs' },
  { name: 'cron', description: 'Manage scheduled tasks' },
  { name: 'goal', description: 'Manage durable goals' },
  { name: 'config [options]', description: 'View and edit configuration' },
  { name: 'image', description: 'Inspect image provider availability' },
  { name: 'models [options]', description: 'List and manage models and model auth' },
  { name: 'providers', description: 'Manage LLM provider credentials (user-friendly hub over `xopc auth`)' },
  { name: 'voice', description: 'Configure text-to-speech (TTS) output' },
  { name: 'search', description: 'Manage web-search providers (brave / tavily / bing / searxng)' },
  { name: 'skills', description: 'Manage skills' },
  { name: 'tailscale', description: 'Tailscale status for gateway remote access' },
  { name: 'browser', description: 'Browser automation commands (uses Playwright)' },
  { name: 'agents', description: 'Manage agents (config + workspace)' },
  { name: 'extensions', description: 'Manage extensions' },
  { name: 'help [command]', description: 'display help for command' },
];

function formatRows(rows: Array<{ label: string; description: string }>): string {
  const labelWidth = Math.max(...rows.map((row) => row.label.length)) + 2;
  return rows.map((row) => `  ${row.label.padEnd(labelWidth)}${row.description}`).join('\n');
}

export function formatRootHelp(): string {
  const options = formatRows(ROOT_HELP_OPTIONS.map((option) => ({ label: option.flags, description: option.description })));
  const commands = formatRows(
    ROOT_HELP_COMMANDS.map((command) => ({ label: command.name, description: command.description })),
  );
  return `Usage: xopc [options] [command]

${ROOT_COMMAND_DESCRIPTION}

Options:
${options}

Commands:
${commands}`;
}
