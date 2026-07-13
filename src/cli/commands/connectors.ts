import { confirm } from '@inquirer/prompts';
import { Command } from 'commander';

import type { ConnectorInstallInput } from '../../connectors/types.js';
import { getStoreConnectorInstallPlan, installStoreConnector, listStoreConnectors } from '../../capabilities/store-connector.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { register, type CLIContext } from '../registry.js';

function parsePairs(values: string[] | undefined, option: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf('=');
    const key = index > 0 ? value.slice(0, index).trim() : '';
    const raw = index > 0 ? value.slice(index + 1) : '';
    if (!key || !raw) {
      throw new Error(`${option} must use KEY=VALUE.`);
    }
    output[key] = raw;
  }
  return output;
}

function printPlan(plan: Awaited<ReturnType<typeof getStoreConnectorInstallPlan>>): void {
  console.log('');
  console.log('Connector install review');
  console.log(`  Package: ${plan.packageName}@${plan.version}`);
  console.log(`  Name: ${plan.definition.displayName}`);
  console.log(`  Authentication: ${plan.definition.auth.mode}`);
  console.log(`  Endpoint: ${plan.definition.runtime.type === 'mcp' ? String(plan.definition.runtime.serverTemplate.url) : 'n/a'}`);
  if (plan.permissions.data?.length) console.log(`  Data permissions: ${plan.permissions.data.join(', ')}`);
  if (plan.permissions.networkDomains?.length) console.log(`  Network domains: ${plan.permissions.networkDomains.join(', ')}`);
  console.log('  Local command execution: denied');
  console.log('');
}

function createConnectorsCommand(ctx: CLIContext): Command {
  const command = new Command('connectors').description('Browse and install verified connector capabilities from xopc-store');

  command
    .command('list [query]')
    .description('List connector capabilities from xopc-store')
    .option('--category <category>', 'Filter by category')
    .option('--json', 'Output JSON')
    .action(async (query: string | undefined, options: { category?: string; json?: boolean }) => {
      const result = await listStoreConnectors(loadConfig(ctx.configPath), {
        q: query,
        category: options.category,
        page: 1,
        pageSize: 50,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.items.length === 0) {
        console.log('No connector capabilities found.');
        return;
      }
      for (const item of result.items) {
        console.log(`${item.name}${item.latestVersion ? `@${item.latestVersion}` : ''}`);
        console.log(`  ${item.description}`);
      }
    });

  command
    .command('install <packageName>')
    .description('Verify and install a connector capability from xopc-store')
    .option('--version <version>', 'Install an exact version')
    .option('--secret <KEY=VALUE>', 'Provide a required secret; repeat for multiple values', (value, previous: string[] = []) => [...previous, value], [])
    .option('--config-value <KEY=VALUE>', 'Provide a connector config value; repeat for multiple values', (value, previous: string[] = []) => [...previous, value], [])
    .option('-y, --yes', 'Skip the interactive confirmation', false)
    .action(async (packageName: string, options: {
      version?: string;
      secret?: string[];
      configValue?: string[];
      yes?: boolean;
    }) => {
      try {
        const config = loadConfig(ctx.configPath);
        const plan = await getStoreConnectorInstallPlan(config, packageName, options.version);
        printPlan(plan);
        if (!options.yes && process.stdin.isTTY) {
          const accepted = await confirm({ message: 'Install this connector?', default: false });
          if (!accepted) {
            console.log('Install cancelled.');
            return;
          }
        }
        const input: ConnectorInstallInput = {
          secrets: parsePairs(options.secret, '--secret'),
          config: parsePairs(options.configValue, '--config-value'),
        };
        const { instance } = await installStoreConnector(config, packageName, input, options.version);
        await saveConfig(config, ctx.configPath);
        console.log(`Installed ${instance.displayName} (${instance.instanceId}).`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  return command;
}

register({
  id: 'connectors',
  name: 'connectors',
  description: 'Browse and install verified connector capabilities from xopc-store',
  factory: createConnectorsCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc connectors list',
      'xopc connectors install demo-connector',
      'xopc connectors install api-connector --secret API_KEY=…',
    ],
  },
});

export { createConnectorsCommand };
