import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';

import { copySqliteAssets } from '../../../../scripts/sqlite-assets.mjs';
import { SCENE_TABLES, NOTIFICATION_LEDGER_TABLES } from '../scenes-schema.js';

const source = fileURLToPath(new URL('..', import.meta.url));
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('SQLite assets in distribution layouts', () => {
  it('loads SQL from an explicit packaged asset root', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-sql-assets-root-')); temporary.push(directory);
    const bundleDirectory = join(directory, 'bundle');
    const assetDirectory = join(directory, 'unpacked/out/server');
    mkdirSync(assetDirectory, { recursive: true });
    writeFileSync(join(assetDirectory, 'probe.sql'), 'SELECT 203;');
    const outfile = join(bundleDirectory, 'index.mjs');
    await build({
      stdin: {
        resolveDir: source,
        contents: `import { readSqliteAsset } from './sql-assets.ts';
          console.log(readSqliteAsset('probe.sql'));`,
      },
      outfile, bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22',
    });

    const result = spawnSync(process.execPath, [outfile], {
      encoding: 'utf8',
      env: { ...process.env, XOPC_SQLITE_ASSET_ROOT: assetDirectory },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('SELECT 203;');
  });

  it('loads baseline and scene SQL beside a minified single-file gateway bundle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-sql-assets-')); temporary.push(directory);
    const outfile = join(directory, 'index.mjs');
    await build({
      stdin: {
        resolveDir: source,
        contents: `import { DatabaseSync } from 'node:sqlite';
          import { readSqliteAsset } from './sql-assets.ts';
          import { installSceneStorage } from './scenes-schema.ts';
          const db = new DatabaseSync(':memory:');
          db.exec(readSqliteAsset('schema.sql'));
          installSceneStorage(db);
          console.log(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name)));
          db.close();`,
      },
      outfile, bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22',
    });
    copySqliteAssets(source, directory, { clean: true });
    const result = spawnSync(process.execPath, [outfile], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expect.arrayContaining([
      ...SCENE_TABLES, ...NOTIFICATION_LEDGER_TABLES,
    ]));
    rmSync(join(directory, 'schemas/notifications.sql'));
    const missing = spawnSync(process.execPath, [outfile], { encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('ENOENT');
  });

  it('copies only current SQL, removes stale Electron assets, and preserves unbundled JavaScript', () => {
    const directory = mkdtempSync(join(tmpdir(), 'xopc-sql-copy-')); temporary.push(directory);
    const stale = join(directory, 'migrations/stale.sql');
    mkdirSync(dirname(stale), { recursive: true }); writeFileSync(stale, 'STALE');
    copySqliteAssets(source, directory, { clean: true });
    expect(readdirSync(join(directory, 'migrations'))).not.toContain('stale.sql');
    expect(readdirSync(join(directory, 'schemas')).filter((name) => !name.endsWith('.sql'))).toEqual([]);
    expect(readFileSync(join(directory, 'schemas/scenes.sql'), 'utf8'))
      .toBe(readFileSync(join(source, 'schemas/scenes.sql'), 'utf8'));
    const runtime = join(directory, 'migrations/runner.js'); writeFileSync(runtime, 'current runtime');
    copySqliteAssets(source, directory);
    expect(readFileSync(runtime, 'utf8')).toBe('current runtime');
  });
});
