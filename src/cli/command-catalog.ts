export type CliExtensionLoadPolicy = 'never' | 'when-configured' | 'always';
export type CliGatewaySubcommandPolicy = 'lazy' | 'eager';

export type CliCommandPathPolicy = {
  loadExtensions: CliExtensionLoadPolicy;
  gatewaySubcommands: CliGatewaySubcommandPolicy;
};

export type CliCommandCatalogEntry = {
  commandPath: readonly string[];
  exact?: boolean;
  policy?: Partial<CliCommandPathPolicy>;
};

export const cliCommandCatalog: readonly CliCommandCatalogEntry[] = [
  { commandPath: ['setup'], policy: { loadExtensions: 'never' } },
  { commandPath: ['onboard'], policy: { loadExtensions: 'never' } },
  { commandPath: ['config'], policy: { loadExtensions: 'never' } },
  { commandPath: ['doctor'], policy: { loadExtensions: 'never' } },
  { commandPath: ['models'], policy: { loadExtensions: 'never' } },
  { commandPath: ['providers'], policy: { loadExtensions: 'never' } },
  { commandPath: ['auth'], policy: { loadExtensions: 'never' } },
  { commandPath: ['logs'], policy: { loadExtensions: 'never' } },
  { commandPath: ['update'], policy: { loadExtensions: 'never' } },
  { commandPath: ['session'], policy: { loadExtensions: 'never' } },
  { commandPath: ['cron'], policy: { loadExtensions: 'never' } },
  { commandPath: ['mcp'], policy: { loadExtensions: 'never' } },
  { commandPath: ['search'], policy: { loadExtensions: 'never' } },
  { commandPath: ['voice'], policy: { loadExtensions: 'never' } },
  { commandPath: ['image'], policy: { loadExtensions: 'never' } },
  { commandPath: ['skills'], policy: { loadExtensions: 'never' } },
  { commandPath: ['tailscale'], policy: { loadExtensions: 'never' } },
  { commandPath: ['tunnel'], policy: { loadExtensions: 'never' } },
  { commandPath: ['browser'], policy: { loadExtensions: 'never' } },
  { commandPath: ['tui'], policy: { loadExtensions: 'when-configured' } },
  { commandPath: ['agent'], policy: { loadExtensions: 'when-configured' } },
  { commandPath: ['channels'], policy: { loadExtensions: 'always' } },
  { commandPath: ['extensions'], policy: { loadExtensions: 'always' } },
  { commandPath: ['agents'], policy: { loadExtensions: 'when-configured' } },
  {
    commandPath: ['gateway'],
    exact: true,
    policy: { loadExtensions: 'never', gatewaySubcommands: 'lazy' },
  },
  { commandPath: ['gateway', 'token'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'status'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'health'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'call'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'probe'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'stop'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'restart'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'logs'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'install'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'uninstall'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'start'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'service-status'], exact: true, policy: { loadExtensions: 'never' } },
  { commandPath: ['gateway', 'ssh-tunnel'], exact: true, policy: { loadExtensions: 'never' } },
];
