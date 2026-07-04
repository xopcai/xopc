import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ConfigSchema, type Config } from '../config/schema.js';
import { createLogger } from '../utils/logger.js';
import { defaultCapabilityPresetMigration } from './config/default-capability-preset.js';
import { listRegisteredMigrations } from './registry.js';
import type { Migration, MigrationContext, MigrationLedger, MigrationPlanItem } from './types.js';

const log = createLogger('Migrations');
const MIGRATION_LEDGER_FILENAME = 'migrations.json';
const CONFIG_BACKUP_COUNT = 10;

const CONFIG_MIGRATIONS: readonly Migration[] = [defaultCapabilityPresetMigration];
export const CORE_MIGRATIONS: readonly Migration[] = [...CONFIG_MIGRATIONS];

function listAllMigrations(): Migration[] {
  return [...CORE_MIGRATIONS, ...listRegisteredMigrations().map((entry) => entry.migration)];
}

export type MigrationApplyMode = 'auto-safe' | 'doctor-fix' | 'manual';

export interface MigrationApplyResult {
  items: MigrationPlanItem[];
  changed: boolean;
}

function publicItem(item: MigrationPlanItem): MigrationPlanItem {
  if (!item.details || !Object.hasOwn(item.details, 'config')) return item;
  const { config: _config, ...details } = item.details;
  return { ...item, details };
}

function makeContext(configPath: string, stateDir?: string): MigrationContext {
  return { configPath, stateDir: stateDir ?? dirname(configPath), now: new Date() };
}

function rotateConfigBackupsSync(configPath: string): void {
  const backupBase = `${configPath}.bak`;
  for (let index = CONFIG_BACKUP_COUNT - 1; index >= 1; index--) {
    const source = index === 1 ? backupBase : `${backupBase}.${index - 1}`;
    const target = `${backupBase}.${index}`;
    if (existsSync(source)) {
      try { renameSync(source, target); } catch { /* best effort */ }
    }
  }
}

function writeConfigWithBackupSync(configPath: string, config: Config): void {
  const validated = ConfigSchema.parse(config);
  mkdirSync(dirname(configPath), { recursive: true });
  if (existsSync(configPath)) {
    rotateConfigBackupsSync(configPath);
    try {
      writeFileSync(`${configPath}.bak`, readFileSync(configPath, 'utf8'), 'utf8');
    } catch {
      // best-effort backup; atomic write below still proceeds
    }
  }
  const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  renameSync(tmp, configPath);
}

function resolveLedgerPath(ctx: MigrationContext): string | null {
  if (!ctx.stateDir) return null;
  return join(ctx.stateDir, MIGRATION_LEDGER_FILENAME);
}

function readLedger(ctx: MigrationContext): MigrationLedger {
  const ledgerPath = resolveLedgerPath(ctx);
  if (!ledgerPath || !existsSync(ledgerPath)) return { version: 1, runs: [] };
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Partial<MigrationLedger>;
    if (parsed.version === 1 && Array.isArray(parsed.runs)) {
      return { version: 1, runs: parsed.runs as MigrationLedger['runs'] };
    }
  } catch {
    // Corrupt migration ledgers should never block runtime startup.
  }
  return { version: 1, runs: [] };
}

function appendLedgerRun(ctx: MigrationContext, item: MigrationPlanItem): void {
  const ledgerPath = resolveLedgerPath(ctx);
  if (!ledgerPath) return;
  try {
    const ledger = readLedger(ctx);
    ledger.runs.push({
      id: item.id,
      status: item.status,
      appliedAt: (ctx.now ?? new Date()).toISOString(),
      message: item.message,
    });
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.warn({ err, errorMessage: em, path: ledgerPath }, `Failed to write migration ledger: ${em}`);
  }
}

function shouldApply(item: MigrationPlanItem, mode: MigrationApplyMode): boolean {
  if (item.status !== 'planned') return false;
  if (mode === 'manual') return true;
  return item.safety === 'auto';
}

export function detectMigrations(configPath: string, options: { stateDir?: string } = {}): MigrationPlanItem[] {
  const ctx = makeContext(configPath, options.stateDir);
  const items: MigrationPlanItem[] = [];
  for (const migration of listAllMigrations()) {
    try {
      const item = migration.detect(ctx);
      if (item) items.push(publicItem(item));
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      items.push({
        id: migration.id,
        title: migration.id,
        kind: migration.kind,
        safety: migration.safety,
        status: 'error',
        message: `Migration detection failed: ${em}`,
      });
    }
  }
  return items;
}

export function applyMigrations(
  configPath: string,
  options: { stateDir?: string; mode?: MigrationApplyMode } = {},
): MigrationApplyResult {
  const ctx = makeContext(configPath, options.stateDir);
  const mode = options.mode ?? 'auto-safe';
  const results: MigrationPlanItem[] = [];
  let changed = false;

  for (const migration of listAllMigrations()) {
    let detected: MigrationPlanItem | null;
    try {
      detected = migration.detect(ctx);
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      results.push({
        id: migration.id,
        title: migration.id,
        kind: migration.kind,
        safety: migration.safety,
        status: 'error',
        message: `Migration detection failed: ${em}`,
      });
      continue;
    }

    if (!detected) continue;
    if (!shouldApply(detected, mode)) {
      results.push(publicItem(detected));
      continue;
    }

    try {
      const applied = migration.apply(ctx);
      const nextConfig = applied.details?.config;
      if (applied.status === 'applied' && nextConfig) {
        writeConfigWithBackupSync(configPath, ConfigSchema.parse(nextConfig));
        changed = true;
        appendLedgerRun(ctx, applied);
      }
      results.push(publicItem(applied));
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      results.push({
        ...detected,
        status: 'error',
        message: `Migration apply failed: ${em}`,
      });
    }
  }

  return { items: results, changed };
}

export function runBootstrapMigrationsSync(configPath: string, options: { stateDir?: string } = {}): MigrationApplyResult {
  if (!existsSync(configPath)) return { items: [], changed: false };
  const result = applyMigrations(configPath, { ...options, mode: 'auto-safe' });
  if (result.changed) {
    log.info({ configPath, count: result.items.filter((item) => item.status === 'applied').length }, 'Applied bootstrap migrations');
  }
  return result;
}
