import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true } }));

import { ensureGatewayConfigForElectron } from '../../../electron/ensure-gateway-config.js';
import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { loadConfig } from '../../config/loader.js';
import { closeXopcDatabase, getSqliteDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';

let directory: string | undefined;

afterEach(() => {
  closeXopcDatabase();
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('packaged desktop upgrade', () => {
  it.each(['file', 'catalog', 'both'] as const)(
    'starts with retired Workflow fields in %s and keeps current credentials and Agents', async (location) => {
      directory = mkdtempSync(join(tmpdir(), 'xopc-desktop-upgrade-'));
      vi.stubEnv('XOPC_STATE_DIR', directory);
      vi.stubEnv('XOPC_SQLITE_ASSET_ROOT', resolve('src/storage/sqlite'));
      closeXopcDatabase();
      openXopcDatabase({ path: join(directory, 'xopc.db') });
      const repository = new AgentCatalogRepository();
      repository.ensureInitialized();
      const before = repository.getSettings().defaults;
      if (location !== 'file') {
        const db = getSqliteDatabase();
        db.exec(`UPDATE agent_catalog_settings SET defaults_json = json_set(defaults_json, '$.workflows', json('{}'));
          UPDATE agents SET overrides_json = json_set(overrides_json, '$.workflows', json('{}'));`);
      }
      const configPath = join(directory, 'xopc.json');
      writeFileSync(configPath, JSON.stringify({
        gateway: { port: 18791, auth: { mode: 'token', token: 'existing-upgrade-token' } },
        ...(location !== 'catalog' ? { workflows: { enabled: true } } : {}),
      }));
      const paths = { configPath, stateDir: directory, electronUserData: join(directory, 'electron'),
        workspacePath: join(directory, 'workspace', 'main') };

      const result = await ensureGatewayConfigForElectron(paths);
      expect(result).toMatchObject({ port: 18791, token: 'existing-upgrade-token' });
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).not.toHaveProperty('workflows');
      expect(loadConfig(configPath).gateway.auth.token).toBe('existing-upgrade-token');
      expect(repository.getSettings().defaults).toEqual(before);
      expect(repository.get('main')?.workspace).toBe(paths.workspacePath);
      expect(repository.get('coder')).not.toBeNull();
      const after = readFileSync(configPath, 'utf8');
      await ensureGatewayConfigForElectron(paths);
      expect(readFileSync(configPath, 'utf8')).toBe(after);
    },
  );
});
