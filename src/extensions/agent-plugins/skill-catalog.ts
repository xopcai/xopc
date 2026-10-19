import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { parseSkillLocalizations } from '../../agent/skills/parse-skill-metadata.js';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import type { SkillCatalogEntry } from '../../agent/agent-manager.js';
import { createSkillConfigManager } from '../../agent/skills/config.js';
import { buildSkillMarkdownPreviewFromRaw } from '../../agent/skills/skill-markdown-preview-from-raw.js';
import { agentPluginInventoryRow } from './inventory.js';
import { AgentPluginStore } from './store.js';
import { containedPath } from './validation.js';

export function pluginSkillName(plugin: ReturnType<AgentPluginStore['list']>[number], name: string) {
  return plugin.layout?.dialect !== 'portable' ? `${plugin.id}.${name}` : name;
}

/** Browse installed content without enabling it in the Agent runtime. */
export function withPluginSkillCatalog(catalog: SkillCatalogEntry[], store = new AgentPluginStore()) {
  const rows = [...catalog];
  const config = createSkillConfigManager(store.stateDir).load();
  for (const plugin of store.list()) {
    const inventory = agentPluginInventoryRow(plugin, store);
    const owner = { id: plugin.id, name: plugin.manifest.name, title: inventory.setup.authorizations.length === 1 ? inventory.setup.authorizations[0]!.title : plugin.manifest.name,
      authorizationStatus: inventory.authorizationStatus, active: inventory.active, readiness: plugin.readiness };
    for (const skill of plugin.skills) {
      const name = pluginSkillName(plugin, skill.name);
      const index = rows.findIndex(row => row.origin === `plugin:${plugin.id}` && row.name === name);
      try {
        const raw = readFileSync(containedPath(plugin.rootDir, skill.filePath), 'utf8');
        const preview = buildSkillMarkdownPreviewFromRaw(raw, { name, description: '' });
        const { frontmatter } = parseFrontmatter(raw);
        const fm = frontmatter as Record<string, unknown>;
        const localized = parseSkillLocalizations(fm).localizations;
        const localizations = localized ?? { en: { displayName: skill.name, description: preview.description }, 'zh-CN': {
          displayName: typeof fm.displayName === 'string' ? fm.displayName : skill.name,
          description: typeof fm.displayDescription === 'string' ? fm.displayDescription : preview.description } };
        if (index >= 0) { rows[index] = { ...rows[index]!, localizations, plugin: owner }; continue; }
        rows.push({ localizations, directoryId: basename(dirname(skill.filePath)), name, description: preview.description,
          source: 'global', origin: `plugin:${plugin.id}`, path: dirname(skill.filePath),
          managed: false, writable: false, enabled: config.entries?.[name]?.enabled !== false, disableModelInvocation: preview.disableModelInvocation,
          plugin: owner });
      } catch { /* Invalid package content remains visible in plugin diagnostics. */ }
    }
  }
  return rows;
}

export function pluginSkillPreview(name: string, store = new AgentPluginStore()) {
  for (const plugin of store.list()) {
    const skill = plugin.skills.find(skill => pluginSkillName(plugin, skill.name) === name);
    if (!skill) continue;
    try {
      const preview = buildSkillMarkdownPreviewFromRaw(readFileSync(containedPath(plugin.rootDir, skill.filePath), 'utf8'), { name, description: '' });
      return { ...preview, name };
    } catch { return null; }
  }
  return null;
}
