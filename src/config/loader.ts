import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { Config, ConfigSchema } from './schema.js';
import { config } from 'dotenv';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigLoader');

export function loadConfig(configPath?: string): Config {
  // Load from .env first
  config();

  const defaultPath = join(homedir(), '.xopcbot', 'config.json');
  const path = configPath || process.env.CONFIG_PATH || defaultPath;

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      const json = JSON.parse(content);
      return ConfigSchema.parse(json);
    } catch (error) {
      log.error({ err: error, path }, `Failed to load config`);
      // Return default config on error
      return ConfigSchema.parse({});
    }
  }

  // Return default config if no file found
  return ConfigSchema.parse({});
}

export function saveConfig(config: Config, configPath?: string): void {
  const defaultPath = join(homedir(), '.xopcbot', 'config.json');
  const path = configPath || process.env.CONFIG_PATH || defaultPath;

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);
  writeFileSync(path, content, 'utf-8');
}

export function getConfigPath(): string {
  return process.env.CONFIG_PATH || join(homedir(), '.xopcbot', 'config.json');
}
