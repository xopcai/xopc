import { readFileSync } from 'node:fs';

import { BUNDLED_CHANNEL_EXTENSIONS, isBundledChannelExtension } from '../channels/bundled-channel-extensions.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { createLogger } from '../utils/logger.js';
import { ConfigSchema, type Config } from './schema.js';

const log = createLogger('ConfigFile');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migrateBundledChannelActivation(config: Record<string, unknown>): boolean {
  if (!isRecord(config.extensions)) return false;

  const extensions = config.extensions;
  const disabled = Array.isArray(extensions.disabled) ? extensions.disabled : [];
  let changed = false;
  for (const key of ['enabled', 'disabled'] as const) {
    const ids = extensions[key];
    if (!Array.isArray(ids)) continue;
    const remaining = ids.filter((id) => typeof id !== 'string' || !isBundledChannelExtension(id));
    if (remaining.length === ids.length) continue;
    changed = true;
    if (remaining.length > 0) extensions[key] = remaining;
    else delete extensions[key];
  }
  if (!changed) return false;

  if (config.channels === undefined || isRecord(config.channels)) {
    const channels: Record<string, unknown> = isRecord(config.channels) ? config.channels : {};
    for (const { extensionId, channelId } of BUNDLED_CHANNEL_EXTENSIONS) {
      if (!disabled.includes(extensionId)) continue;
      const channel = channels[channelId];
      if (isRecord(channel)) channel.enabled = false;
      else if (channel === undefined) channels[channelId] = { enabled: false };
      else continue;
      config.channels = channels;
    }
  }
  return true;
}

/** Validate existing settings before committing migrations to disk. */
export function readConfigFileSnapshot(path: string): {
  config: Config;
  persistMigrations: () => void;
} {
  const original = readFileSync(path, 'utf8');
  const raw: unknown = JSON.parse(original);
  let migrated = false;
  if (isRecord(raw)) {
    if (Object.hasOwn(raw, 'workflows')) {
      delete raw.workflows;
      migrated = true;
    }
    migrated = migrateBundledChannelActivation(raw) || migrated;
  }
  const config = ConfigSchema.parse(raw);

  return {
    config,
    persistMigrations: () => {
      if (!migrated) return;
      try {
        // A validator may be asynchronous; do not overwrite a newer edit.
        if (readFileSync(path, 'utf8') !== original) return;
        writeTextAtomicSync(path, `${JSON.stringify(raw, null, 2)}\n`);
      } catch (err) {
        // Read-only settings must not prevent startup with valid current values.
        log.warn({ err, path }, 'Could not persist configuration migrations');
      }
    },
  };
}
