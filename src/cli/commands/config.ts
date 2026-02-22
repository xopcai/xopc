import { Command } from 'commander';
import { existsSync, writeFileSync } from 'fs';
import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

const log = createLogger('ConfigCommand');

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current: any, key: string) => {
    if (current && typeof current === 'object' && key in current) {
      return current[key];
    }
    return undefined;
  }, obj);
}

function setNestedValue(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((current: any, key: string) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
  return obj;
}

function createConfigCommand(ctx: CLIContext): Command {
  const cmd = new Command('config')
    .description('View and edit configuration')
    .addHelpText(
      'after',
      formatExamples([
        'xopcbot config get agents.defaults.model',
        'xopcbot config set agents.defaults.temperature 0.8',
        'xopcbot config unset agents.defaults.max_tokens',
        'xopcbot config show',
        'xopcbot config token              # Show gateway token info',
        'xopcbot config token --show       # Show full token',
        'xopcbot config token --generate   # Generate new token',
      ])
    );

  cmd
    .command('get <path>')
    .description('Get a config value by dot path')
    .action((path: string) => {
      if (!existsSync(ctx.configPath)) {
        log.error('Config file not found. Run: xopcbot onboard');
        process.exit(1);
      }

      const config = loadConfig(ctx.configPath);
      const value = getNestedValue(config, path);

      if (value === undefined) {
        log.error({ path }, `Config path not found`);
        process.exit(1);
      }

      console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
    });

  cmd
    .command('set <path> <value>')
    .description('Set a config value by dot path')
    .action((path: string, value: string) => {
      if (!existsSync(ctx.configPath)) {
        log.error('Config file not found. Run: xopcbot onboard');
        process.exit(1);
      }

      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      const config = loadConfig(ctx.configPath);
      setNestedValue(config, path, parsedValue);

      writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
      
      log.info({ path }, `Config updated`);
    });

  cmd
    .command('unset <path>')
    .description('Remove a config value by dot path')
    .action((path: string) => {
      if (!existsSync(ctx.configPath)) {
        log.error('Config file not found. Run: xopcbot onboard');
        process.exit(1);
      }

      const config = loadConfig(ctx.configPath);
      const keys = path.split('.');
      const lastKey = keys.pop()!;
      const target = keys.reduce((current: any, key: string) => {
        return current && current[key];
      }, config);

      if (target && typeof target === 'object' && lastKey in target) {
        delete target[lastKey];
        writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
        log.info({ path }, `Config removed`);
      } else {
        log.error({ path }, `Config path not found`);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show full configuration (sensitive values masked)')
    .action(() => {
      if (!existsSync(ctx.configPath)) {
        log.warn('No config file found. Run: xopcbot onboard');
        return;
      }

      const config = loadConfig(ctx.configPath);
      
      const maskedConfig = JSON.stringify(config, (key, value) => {
        if (key === 'api_key' || key === 'token') {
          return value ? '********' : value;
        }
        return value;
      }, 2);

      console.log(maskedConfig);
    });

  cmd
    .command('token')
    .description('Generate or view the gateway auth token')
    .option('--generate', 'Generate a new token')
    .option('--show', 'Show the current token (unmasked)')
    .action(async (options) => {
      if (!existsSync(ctx.configPath)) {
        log.error('Config file not found. Run: xopcbot onboard');
        process.exit(1);
      }

      const config = loadConfig(ctx.configPath);

      if (options.show) {
        const token = config?.gateway?.auth?.token;
        if (token) {
          console.log(token);
        } else {
          console.log('No token configured. Gateway auth mode:', config?.gateway?.auth?.mode || 'not set');
        }
        return;
      }

      if (options.generate) {
        const crypto = await import('crypto');
        const newToken = crypto.randomBytes(24).toString('hex');

        config.gateway = config.gateway || {};
        config.gateway.auth = {
          mode: 'token',
          token: newToken,
        };

        writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
        log.info('New gateway token generated');
        console.log(`Token: ${newToken.slice(0, 8)}...${newToken.slice(-8)}`);
        console.log('\nUse "xopcbot config token --show" to view the full token');
        return;
      }

      // Default: show masked token info
      const token = config?.gateway?.auth?.token;
      const mode = config?.gateway?.auth?.mode;
      const host = config?.gateway?.host || '0.0.0.0';
      const port = config?.gateway?.port || 18790;

      console.log('Gateway Configuration:');
      console.log(`  Host: ${host}`);
      console.log(`  Port: ${port}`);
      console.log(`  Auth Mode: ${mode || 'not set'}`);
      if (token) {
        console.log(`  Token: ${token.slice(0, 8)}...${token.slice(-8)}`);
        console.log('\nUse "xopcbot config token --show" to view the full token');
        console.log('Use "xopcbot config token --generate" to generate a new token');
      } else if (mode === 'token') {
        console.log('  Token: not set (will be auto-generated on first gateway start)');
      }
    });

  cmd
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(ctx.configPath);
    });

  return cmd;
}

register({
  id: 'config',
  name: 'config',
  description: 'View and edit configuration',
  factory: createConfigCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopcbot config get agents.defaults.model',
      'xopcbot config set agents.defaults.temperature 0.8',
      'xopcbot config show',
      'xopcbot config token',
      'xopcbot config token --show',
      'xopcbot config token --generate',
    ],
  },
});
