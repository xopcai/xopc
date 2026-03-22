import { readFileSync, existsSync, mkdirSync, promises as fsPromises } from 'fs';
import { dirname } from 'path';
import { type Config, ConfigSchema } from './schema.js';
import { resolveConfigPath } from './paths.js';
import { config } from 'dotenv';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigLoader');

/** Number of backup files to keep */
const CONFIG_BACKUP_COUNT = 10;

/**
 * Rotate config backups before writing new config.
 * Creates a backup chain: xopcbot.json.bak, xopcbot.json.bak.1, xopcbot.json.bak.2, etc.
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

/**
 * Load configuration from file
 * @param configPath Optional custom config path, defaults to XOPCBOT_CONFIG_PATH or ~/.xopcbot/xopcbot.json
 */
export function loadConfig(configPath?: string): Config {
  config();

  const path = configPath || process.env.XOPCBOT_CONFIG_PATH || resolveConfigPath();

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      const json = JSON.parse(content);
      return ConfigSchema.parse(json);
    } catch (error) {
      log.error({ err: error, path }, `Failed to load config`);
      return ConfigSchema.parse(undefined);
    }
  }

  return ConfigSchema.parse(undefined);
}

/**
 * Save configuration to file
 * @param config Configuration object to save
 * @param configPath Optional custom config path
 */
export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const path = configPath || process.env.XOPCBOT_CONFIG_PATH || resolveConfigPath();

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const validated = ConfigSchema.parse(config);
  const content = JSON.stringify(validated, null, 2);

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

// Re-export for backward compatibility
export { resolveConfigPath } from './paths.js';
