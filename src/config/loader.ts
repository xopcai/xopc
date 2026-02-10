import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Config, ConfigSchema } from './schema.js';
import { DEFAULT_PATHS } from './paths.js';
import { config } from 'dotenv';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigLoader');

export function loadConfig(configPath?: string): Config {
  config();

  const path = configPath || process.env.CONFIG_PATH || DEFAULT_PATHS.config;

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      const json = JSON.parse(content);
      return ConfigSchema.parse(json);
    } catch (error) {
      log.error({ err: error, path }, `Failed to load config`);
      return ConfigSchema.parse({});
    }
  }

  return ConfigSchema.parse({});
}

export function saveConfig(config: Config, configPath?: string): void {
  const path = configPath || process.env.CONFIG_PATH || DEFAULT_PATHS.config;

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);
  writeFileSync(path, content, 'utf-8');
}

export { DEFAULT_PATHS };
