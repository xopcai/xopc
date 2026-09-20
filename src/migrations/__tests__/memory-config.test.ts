import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

import { expect, it } from 'vitest';

import { saveConfig } from '../../config/loader.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveGatewayLockPath } from '../../gateway/lock.js';
import { runBootstrapMigrationsSync } from '../runner.js';

it('splits legacy knowledge memory sources once and preserves the original backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-knowledge-memory-config-'));
  try {
    const path = join(dir, 'xopc.json');
    const original = JSON.stringify({
      userContext: {
        knowledgeMemory: {
          enabled: true,
          sources: ['session', 'workspace', 'connector'],
        },
      },
    });
    writeFileSync(path, original);

    expect(runBootstrapMigrationsSync(path).changed).toBe(true);
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe(original);
    const migrated = JSON.parse(readFileSync(path, 'utf8'));
    expect(migrated.userContext.knowledgeMemory).toMatchObject({
      readScopes: ['session', 'workspace'],
      contentSources: ['memory', 'local_import', 'connector'],
    });
    expect(migrated.userContext.knowledgeMemory).not.toHaveProperty('sources');
    expect(runBootstrapMigrationsSync(path).changed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('defers the breaking config rewrite while another gateway process owns the config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-knowledge-memory-locked-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    if (!child.pid) throw new Error('Failed to start gateway lock test process');
    const path = join(dir, 'xopc.json');
    const original = JSON.stringify({
      userContext: { knowledgeMemory: { sources: ['session', 'workspace'] } },
    });
    writeFileSync(path, original);
    const lockPath = resolveGatewayLockPath(path);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: child.pid,
      createdAt: new Date().toISOString(),
      configPath: path,
    }));

    expect(runBootstrapMigrationsSync(path).changed).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(() => ConfigSchema.parse(JSON.parse(original))).toThrow();
    await expect(saveConfig(ConfigSchema.parse({}), path))
      .rejects.toThrow('restart the running gateway');

    rmSync(lockPath, { force: true });
    expect(runBootstrapMigrationsSync(path).changed).toBe(true);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('migrates ordinary confirmation once without changing disabled or sensitive policies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-memory-config-'));
  try {
    const path = join(dir, 'xopc.json');
    writeFileSync(path, JSON.stringify({ userContext: {
      userModel: { writePolicy: 'confirm', sensitiveWritePolicy: 'deny' },
      knowledgeMemory: { writePolicy: 'deny' },
    } }));
    expect(runBootstrapMigrationsSync(path).changed).toBe(true);
    const config = ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    expect(config.userContext.userModel.writePolicy).toBe('allow');
    expect(config.userContext.userModel.sensitiveWritePolicy).toBe('deny');
    expect(config.userContext.knowledgeMemory.writePolicy).toBe('deny');
    expect(runBootstrapMigrationsSync(path).changed).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
