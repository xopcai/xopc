import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const PLUGIN_MANIFEST_PATHS = ['plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json'] as const;
export type PluginDialect = 'portable' | 'codex' | 'claude';
export interface CompatibilityItem {
  component: string;
  support: 'supported' | 'needs_adapter' | 'unsupported' | 'invalid';
  message: string;
}
export interface PluginLayout {
  descriptorVersion: 1;
  adapterVersion: 'xopc-plugin-v1';
  dialect: PluginDialect;
  manifest: Record<string, unknown>;
  skillRoots: string[];
  mcpConfigs: unknown[];
  compatibility: CompatibilityItem[];
  userConfig: Record<string, { type: 'string' | 'number' | 'boolean'; title: string; required: boolean; sensitive: boolean; default?: string | number | boolean }>;
  tasks: string[];
}

/** Interpret each dialect before applying the common package and execution checks. */
export function readPluginLayout(root: string, read: (path: string) => string, safe: (path: string) => string, importManifest?: Record<string, unknown>): PluginLayout {
  const has = (path: string) => existsSync(join(root, path));
  const json = (path: string): Record<string, unknown> => {
    const value = JSON.parse(read(join(root, path)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected an object: ${path}`);
    return value;
  };
  const path = PLUGIN_MANIFEST_PATHS.find(has);
  if (!path && !importManifest) throw new Error('No supported plugin manifest found');
  const dialect: PluginDialect = path === 'plugin.json' ? 'portable' : path?.startsWith('.codex') ? 'codex' : 'claude';
  const raw = path ? json(path) : importManifest!;
  const compatibility: CompatibilityItem[] = [];
  if (dialect !== 'portable' && has('.codex-plugin/plugin.json') && has('.claude-plugin/plugin.json')) compatibility.push({ component: 'manifest:claude', support: 'unsupported', message: 'Codex dialect selected; the separate Claude manifest is not applied.' });
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const overlay = dialect === 'portable'
    ? object(object(raw.extensions)['com.openai'] ?? (has('.codex-plugin/plugin.json') ? json('.codex-plugin/plugin.json') : {}))
    : raw;
  const manifest = dialect === 'portable' ? raw : {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...Object.fromEntries(['name', 'version', 'description', 'homepage', 'repository', 'license', 'keywords', 'extensions'].filter(key => raw[key] !== undefined).map(key => [key, raw[key]])),
    ...(raw.author ? { author: typeof raw.author === 'string' ? { name: raw.author } : raw.author } : {}),
  };
  const paths = (value: unknown, component: string): string[] => {
    if (value === undefined) return [];
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    if (!values.length || values.some(v => typeof v !== 'string' || !v.startsWith('./'))) {
      compatibility.push({ component, support: 'invalid', message: 'Expected package-relative paths beginning with ./' });
      return [];
    }
    return values.map(v => safe(join(root, v as string)));
  };
  const guarded = <T>(component: string, fn: () => T, fallback: T): T => {
    try { return fn(); } catch (error) { compatibility.push({ component, support: 'invalid', message: error instanceof Error ? error.message : String(error) }); return fallback; }
  };
  const defaults = has('skills') ? guarded('skills', () => [safe(join(root, 'skills'))], []) : [];
  const declared = paths(overlay.skills, 'skills');
  const skillRoots = [...new Set(dialect === 'portable' ? defaults : dialect === 'claude' ? [...defaults, ...declared] : overlay.skills === undefined ? defaults : declared)];
  const mcpConfigs: unknown[] = [];
  if (dialect === 'portable' && has('mcp.json')) { const config = guarded('mcp', () => json('mcp.json'), undefined); if (config) mcpConfigs.push(config); }
  const externalMcpConfig = has('.mcp.json');
  if (dialect !== 'portable' && externalMcpConfig && (dialect === 'claude' || overlay.mcpServers === undefined)) { const config = guarded('mcp', () => json('.mcp.json'), undefined); if (config) mcpConfigs.push(config); }
  if (dialect !== 'portable' || !has('mcp.json')) {
    if (overlay.mcpServers !== undefined) {
      for (const item of Array.isArray(overlay.mcpServers) ? overlay.mcpServers : [overlay.mcpServers]) {
        if (typeof item === 'string') for (const file of paths(item, 'mcp')) { const config = guarded('mcp', () => JSON.parse(read(file)), undefined); if (config) mcpConfigs.push(config); }
        else if (item && typeof item === 'object') mcpConfigs.push({ mcpServers: item });
        else compatibility.push({ component: 'mcp', support: 'invalid', message: 'Expected an MCP configuration object or package path.' });
      }
    }
  }
  for (const [key, conventional] of Object.entries({ apps: '.app.json', hooks: 'hooks/hooks.json', agents: 'agents', commands: 'commands', lspServers: '.lsp.json', outputStyles: 'output-styles', settings: 'settings.json', monitors: 'monitors', channels: 'channels', themes: 'themes' })) {
    if (overlay[key] !== undefined || has(conventional)) compatibility.push({ component: key, support: key === 'apps' ? 'needs_adapter' : 'unsupported',
      message: key === 'apps' ? 'Platform application tools require a host capability adapter; accounts are not inherited.' : `${key} is not executed by this compatibility version.` });
  }
  const userConfig: PluginLayout['userConfig'] = Object.create(null);
  for (const [key, value] of Object.entries(object(overlay.userConfig))) {
    const field = object(value);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !['string', 'number', 'boolean'].includes(String(field.type))) {
      compatibility.push({ component: `config:${key}`, support: 'unsupported', message: 'Unsupported configuration field.' });
      continue;
    }
    userConfig[key] = { type: field.type as 'string' | 'number' | 'boolean', title: String(field.title ?? key), required: field.required === true, sensitive: field.sensitive === true,
      ...(['string', 'number', 'boolean'].includes(typeof field.default) ? { default: field.default as string | number | boolean } : {}) };
  }
  const ui = object(overlay.interface);
  const tasks = [ui.defaultPrompt].flat().filter((v): v is string => typeof v === 'string');
  if (overlay.onboardingSkill !== undefined) compatibility.push({ component: 'onboardingSkill', support: 'unsupported', message: 'Automatic onboarding skill execution is not supported; use the host setup flow.' });
  // Enumerate unknown declarations rather than silently claiming full compatibility.
  const known = new Set(['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions', 'displayName', 'skills', 'mcpServers', 'interface', 'userConfig', 'onboardingSkill', 'apps', 'hooks', 'agents', 'commands', 'lspServers', 'outputStyles', 'settings', 'monitors', 'channels', 'themes']);
  for (const key of Object.keys(overlay)) if (!known.has(key)) compatibility.push({ component: key, support: 'unsupported', message: 'Unrecognized platform declaration.' });
  return { descriptorVersion: 1, adapterVersion: 'xopc-plugin-v1', dialect, manifest, skillRoots, mcpConfigs, compatibility, userConfig, tasks };
}

export function collectPluginSkillFiles(root: string, safe: (path: string) => string): string[] {
  const result: string[] = [];
  const visit = (path: string, depth: number) => {
    const target = safe(path);
    if (depth > 16) throw new Error('Skill directory nesting exceeds limits');
    if (statSync(target).isFile()) { if (basename(target) === 'SKILL.md') result.push(target); return; }
    if (existsSync(join(target, 'SKILL.md'))) { result.push(safe(join(target, 'SKILL.md'))); return; }
    for (const name of readdirSync(target).sort()) visit(join(target, name), depth + 1);
  };
  visit(root, 0);
  return result;
}
