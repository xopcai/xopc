import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function freezeMemoryConfig(existing?: string) {
  let directory: string | undefined;
  const path = existing ?? (() => {
    const root = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
    const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH ?? join(root, 'xopc.json'), 'utf8'));
    const db = new DatabaseSync(join(root, 'xopc.db'), { readOnly: true });
    const defaults = JSON.parse(String(db.prepare('SELECT defaults_json FROM agent_catalog_settings LIMIT 1').get()!.defaults_json));
    db.close(); directory = mkdtempSync(join(tmpdir(), 'xopc-memory-config-'));
    const target = join(directory, 'snapshot.json');
    writeFileSync(target, JSON.stringify({ config, defaults }), { mode: 0o600 });
    return target;
  })();
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { path, hash, close() { if (directory) rmSync(directory, { recursive: true, force: true }); } };
}
