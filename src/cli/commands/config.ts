import { Command } from 'commander';
import { existsSync, writeFileSync } from 'fs';
import { loadConfig } from '../../config/index.js';
import { createLogger } from '../../utils/logger.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

const log = createLogger('ConfigCommand');

// Helper to get nested value by dot notation
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current: any, key: string) => {
    if (current && typeof current === 'object' && key in current) {
      return current[key];
    }
    return undefined;
  }, obj);
}

// Helper to set nested value by dot notation
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
      ])
    );

  // Config get
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

  // Config set
  cmd
    .command('set <path> <value>')
    .description('Set a config value by dot path')
    .action((path: string, value: string) => {
      if (!existsSync(ctx.configPath)) {
        log.error('Config file not found. Run: xopcbot onboard');
        process.exit(1);
      }

      // Try to parse as JSON, otherwise use string
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      const config = loadConfig(ctx.configPath);
      setNestedValue(config, path, parsedValue);

      // Save config (simple overwrite)
      writeFileSync(ctx.configPath, JSON.stringify(config, null, 2));
      
      log.info({ path }, `Config updated`);
    });

  // Config unset
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

  // Config show
  cmd
    .command('show')
    .description('Show full configuration (sensitive values masked)')
    .action(() => {
      if (!existsSync(ctx.configPath)) {
        log.warn('No config file found. Run: xopcbot onboard');
        return;
      }

      const config = loadConfig(ctx.configPath);
      
      // Mask sensitive values
      const maskedConfig = JSON.stringify(config, (key, value) => {
        if (key === 'api_key' || key === 'token') {
          return value ? '********' : value;
        }
        return value;
      }, 2);

      console.log(maskedConfig);
    });

  // Config path
  cmd
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      console.log(ctx.configPath);
    });

  return cmd;
}

// 自注册到命令注册表
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
    ],
  },
});
