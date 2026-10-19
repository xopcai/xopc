import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { AgentPluginStore } from '../store.js';
import { pluginSkillPreview, withPluginSkillCatalog } from '../skill-catalog.js';
import { PluginSetupService } from '../setup.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
it('lists installed skills while setup is pending without exposing them to the Agent runtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-catalog-')); roots.push(root);
  const source = join(root, 'source'); mkdirSync(join(source, '.claude-plugin'), { recursive: true });
  mkdirSync(join(source, 'skills', 'sample'), { recursive: true });
  writeFileSync(join(source, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'catalog-demo', version: '1.0.0' }));
  writeFileSync(join(source, 'skills', 'sample', 'SKILL.md'), '---\nname: sample\ndescription: Read a sample\n---\nSample instructions.');
  const store = new AgentPluginStore(join(root, 'state'));
  const plan = store.inspect(source); store.install(source, { reviewHash: plan.reviewHash });
  const plugin = store.list()[0]!;
  new PluginSetupService(store).create(plugin.id, 'test');
  expect(store.active()).toHaveLength(0);
  const rows = withPluginSkillCatalog([], store);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: `${plugin.id}.sample`, managed: false, writable: false,
    plugin: { id: plugin.id, active: false, readiness: 'setup_required' } });
  expect(pluginSkillPreview(rows[0]!.name, store)?.bodyMarkdown).toBe('Sample instructions.');
  expect(pluginSkillPreview('../outside', store)).toBeNull();
  expect(withPluginSkillCatalog(rows, store)).toHaveLength(1);
  expect(store.active()).toHaveLength(0);
});
