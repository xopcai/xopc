import { readFileSync, existsSync, mkdirSync, promises as fsPromises } from 'fs';
import { dirname } from 'path';
import { type Config, ConfigSchema } from './schema.js';
import { resolveConfigPath } from './paths.js';
import { config } from 'dotenv';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ConfigLoader');

/**
 * Optional channel config validator injected at startup to avoid a circular
 * dependency: loader → validate-channel-configs → bundled-channel-plugins →
 * telegram/command-handler → providers → sync-provider-auth → loader.
 *
 * Call {@link registerChannelConfigValidator} once during app bootstrap
 * (after all channel plugins are loaded) to enable validation.
 */
let channelConfigValidator: ((cfg: Config) => void) | null = null;

export function registerChannelConfigValidator(fn: (cfg: Config) => void): void {
  channelConfigValidator = fn;
}

function assertChannelPluginConfigs(cfg: Config): void {
  channelConfigValidator?.(cfg);
}

/** Number of backup files to keep */
const CONFIG_BACKUP_COUNT = 10;

/**
 * Rotate config backups before writing new config.
 * Creates a backup chain: xopc.json.bak, xopc.json.bak.1, xopc.json.bak.2, etc.
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
 * @param configPath Optional custom config path, defaults to XOPC_CONFIG_PATH or ~/.xopc/xopc.json
 */
export function loadConfig(configPath?: string): Config {
  // dotenv ≥17 logs to stdout on every `config()` unless quiet; `loadConfig` runs from many call sites.
  config({ quiet: true });

  const path = configPath || process.env.XOPC_CONFIG_PATH || resolveConfigPath();

  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      const json = JSON.parse(content);
      const cfg = ConfigSchema.parse(json);
      assertChannelPluginConfigs(cfg);
      return cfg;
    } catch (error) {
      log.error({ err: error, path }, `Failed to load config`);
      const cfg = ConfigSchema.parse(undefined);
      assertChannelPluginConfigs(cfg);
      return cfg;
    }
  }

  const cfg = ConfigSchema.parse(undefined);
  assertChannelPluginConfigs(cfg);
  return cfg;
}

/**
 * Save configuration to file
 * @param config Configuration object to save
 * @param configPath Optional custom config path
 */
export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const path = configPath || process.env.XOPC_CONFIG_PATH || resolveConfigPath();

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const validated = ConfigSchema.parse(config);
  assertChannelPluginConfigs(validated);
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

export { resolveConfigPath } from './paths.js';
