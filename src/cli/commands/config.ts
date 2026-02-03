import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from '../../config/index.js';

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

export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .description('View and edit configuration')
    .addHelpText(
      'after',
      `\nExamples:
  $ xopcbot config get agents.defaults.model
  $ xopcbot config set agents.defaults.temperature 0.8
  $ xopcbot config unset agents.defaults.max_tokens
`
    );

  // Config get
  cmd
    .command('get <path>')
    .description('Get a config value by dot path')
    .action((path: string) => {
      const configPath = join(homedir(), '.xopcbot', 'config.json');
      
      if (!existsSync(configPath)) {
        console.error('❌ Config file not found. Run: xopcbot configure');
        process.exit(1);
      }

      const config = loadConfig(configPath);
      const value = getNestedValue(config, path);

      if (value === undefined) {
        console.error(`❌ Config path not found: ${path}`);
        process.exit(1);
      }

      console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
    });

  // Config set
  cmd
    .command('set <path> <value>')
    .description('Set a config value by dot path')
    .action((path: string, value: string) => {
      const configPath = join(homedir(), '.xopcbot', 'config.json');
      
      if (!existsSync(configPath)) {
        console.error('❌ Config file not found. Run: xopcbot configure');
        process.exit(1);
      }

      // Try to parse as JSON, otherwise use string
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }

      const config = loadConfig(configPath);
      setNestedValue(config, path, parsedValue);

      // Save config (simple overwrite)
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      
      console.log(`✅ Updated: ${path}`);
    });

  // Config unset
  cmd
    .command('unset <path>')
    .description('Remove a config value by dot path')
    .action((path: string) => {
      const configPath = join(homedir(), '.xopcbot', 'config.json');
      
      if (!existsSync(configPath)) {
        console.error('❌ Config file not found. Run: xopcbot configure');
        process.exit(1);
      }

      const config = loadConfig(configPath);
      const keys = path.split('.');
      const lastKey = keys.pop()!;
      const target = keys.reduce((current: any, key: string) => {
        return current && current[key];
      }, config);

      if (target && typeof target === 'object' && lastKey in target) {
        delete target[lastKey];
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`✅ Removed: ${path}`);
      } else {
        console.error(`❌ Config path not found: ${path}`);
        process.exit(1);
      }
    });

  // Config show
  cmd
    .command('show')
    .description('Show full configuration')
    .action(() => {
      const configPath = join(homedir(), '.xopcbot', 'config.json');
      
      if (!existsSync(configPath)) {
        console.log('⚠️  No config file found. Run: xopcbot configure');
        return;
      }

      const config = loadConfig(configPath);
      
      // Mask sensitive values
      const maskedConfig = JSON.stringify(config, (key, value) => {
        if (key === 'api_key' || key === 'token') {
          return value ? '********' : value;
        }
        return value;
      }, 2);

      console.log(maskedConfig);
    });

  return cmd;
}
