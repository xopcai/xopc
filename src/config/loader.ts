import { readFileSync, existsSync, mkdirSync, promises as fsPromises } from 'fs';
import { dirname } from 'path';
import { Config, ConfigSchema } from './schema.js';
import { DEFAULT_PATHS } from './paths.js';
import { config } from 'dotenv';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigLoader');

/** Number of backup files to keep */
const CONFIG_BACKUP_COUNT = 20;

/**
 * Rotate config backups before writing new config.
 * Creates a backup chain: config.json.bak, config.json.bak.1, config.json.bak.2, etc.
 */
async function rotateConfigBackups(configPath: string): Promise<void> {
  if (CONFIG_BACKUP_COUNT <= 1) {
    return;
  }

  const backupBase = `${configPath}.bak`;
  const maxIndex = CONFIG_BACKUP_COUNT - 1;

  // Delete oldest backup
  try {
    await fsPromises.unlink(`${backupBase}.${maxIndex}`);
  } catch {
    // best-effort: file may not exist
  }

  // Rotate existing backups: .bak.2 -> .bak.3, .bak.1 -> .bak.2, etc.
  for (let index = maxIndex - 1; index >= 1; index--) {
    try {
      await fsPromises.rename(`${backupBase}.${index}`, `${backupBase}.${index + 1}`);
    } catch {
      // best-effort: file may not exist
    }
  }

  // Move .bak to .bak.1
  try {
    await fsPromises.rename(backupBase, `${backupBase}.1`);
  } catch {
    // best-effort: file may not exist
  }
}

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

export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const path = configPath || process.env.CONFIG_PATH || DEFAULT_PATHS.config;

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);

  // Backup existing config before writing
  if (existsSync(path)) {
    await rotateConfigBackups(path);
    try {
      // Copy current config to .bak as the latest backup
      await fsPromises.copyFile(path, `${path}.bak`);
    } catch {
      // best-effort: backup copy may fail
    }
  }

  await fsPromises.writeFile(path, content, 'utf-8');
}

export { DEFAULT_PATHS };
