import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ImportError, type ImportSource } from './types.js';

interface SourceLayout {
  id: ImportSource;
  name: string;
  directory: string;
  environment: string;
  skills: Array<{ base: 'home' | 'root'; path: string; shared: boolean }>;
  projectSkills: string;
  instructions: string[][];
  projectInstructions: string[][];
  rules?: string;
  projectRules?: string;
  config: { path: string; format: 'json' | 'toml'; mcpKey: string };
  projectConfig: string;
}

/** Product differences live here; readers and destination writers are shared. */
export const IMPORT_SOURCES: readonly SourceLayout[] = [
  {
    id: 'codex', name: 'Codex', directory: '.codex', environment: 'CODEX_HOME',
    skills: [{ base: 'home', path: '.agents/skills', shared: true }],
    projectSkills: '.agents/skills', instructions: [['AGENTS.override.md', 'AGENTS.md']],
    projectInstructions: [['AGENTS.override.md', 'AGENTS.md']],
    config: { path: 'config.toml', format: 'toml', mcpKey: 'mcp_servers' },
    projectConfig: '.codex/config.toml',
  },
  {
    id: 'claude-code', name: 'Claude Code', directory: '.claude', environment: 'CLAUDE_CONFIG_DIR',
    skills: [{ base: 'root', path: 'skills', shared: false }],
    projectSkills: '.claude/skills', instructions: [['CLAUDE.md']],
    projectInstructions: [['CLAUDE.md'], ['.claude/CLAUDE.md'], ['CLAUDE.local.md']],
    rules: 'rules', projectRules: '.claude/rules',
    config: { path: '../.claude.json', format: 'json', mcpKey: 'mcpServers' },
    projectConfig: '.mcp.json',
  },
];

export function sourceLayout(source: ImportSource, home?: string, root?: string) {
  const layout = IMPORT_SOURCES.find(s => s.id === source);
  if (!layout) throw new ImportError('unsupported_source', 'Unsupported source');
  return { layout, home: home ?? homedir(), root: root ?? (home ? undefined : process.env[layout.environment]) ?? join(home ?? homedir(), layout.directory) };
}
export function detectImportSources() {
  return IMPORT_SOURCES.map(s => {
    const { root } = sourceLayout(s.id);
    return { id: s.id, name: s.name, detected: existsSync(root) || existsSync(join(root, s.config.path)) };
  });
}

export function isImportSource(value: string): value is ImportSource {
  return IMPORT_SOURCES.some(source => source.id === value);
}
