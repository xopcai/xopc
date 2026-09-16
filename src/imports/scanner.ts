import { setImmediate as yieldIO } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { inspectMcp, inspectSkill } from './compatibility.js';
import { digest, IMPORT_LIMITS, readRegularFile, readTree } from './files.js';
import { ImportError, type ImportScan, type ImportScope, type ImportSource } from './types.js';
import { IMPORT_SOURCES, sourceLayout } from './sources.js';
import { containsSecret } from './secrets.js';
export { IMPORT_SOURCES } from './sources.js';
export interface ScanInput { source: ImportSource; root?: string; projectRoot?: string; home?: string; projectOnly?: boolean; budget?: { bytes: number; files: number } }
function scanResult(source: ImportSource): ImportScan {
  if (!IMPORT_SOURCES.some(s => s.id === source)) throw new ImportError('unsupported_source', 'Unsupported source');
  return { id: randomUUID(), createdAt: Date.now(), source, candidates: [], diagnostics: [] };
}
function base(source: ImportSource, scope: ImportScope, location: string, shared = false) {
  return { id: randomUUID(), source, scope, location, shared };
}
function appendMcp(scan: ImportScan, raw: unknown, scope: ImportScope, location: string): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const [name, config] of Object.entries(raw)) {
    scan.candidates.push(inspectMcp(base(scan.source, scope, location), name, config));
  }
}
export async function scanLocal(input: ScanInput): Promise<ImportScan> {
  const scan = scanResult(input.source);
  const { home, root, layout } = sourceLayout(input.source, input.home, input.root);
  const scopes: Array<{ path: string; scope: ImportScope; shared: boolean }> = (input.projectOnly ? [] : layout.skills).map(s => ({
    path: join(s.base === 'home' ? home : root, s.path), scope: 'user', shared: s.shared,
  }));
  if (input.projectRoot) scopes.push({ path: join(input.projectRoot, layout.projectSkills), scope: 'project', shared: layout.skills.some(s => s.shared) });
  const seen = new Set<string>();
  const budget = input.budget ?? { bytes: 0, files: 0 };
  const consume = (bytes: number, files: number) => {
    budget.bytes += bytes; budget.files += files;
    if (budget.bytes > IMPORT_LIMITS.total || budget.files > IMPORT_LIMITS.count) throw new ImportError('limit_exceeded', 'Import exceeds batch limits', 413);
  };
  for (const scope of scopes) {
    if (!existsSync(scope.path)) continue;
    let entries;
    try { entries = readdirSync(scope.path, { withFileTypes: true }); }
    catch { scan.diagnostics.push('Unable to read skills directory'); continue; }
    for (const entry of entries) {
      await yieldIO();
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const location = join(scope.path, entry.name);
      if (!existsSync(join(location, 'SKILL.md'))) continue;
      try {
        const real = realpathSync(location);
        if (seen.has(real)) continue;
        seen.add(real);
        const files = readTree(location);
        consume(files.reduce((n, f) => n + Buffer.byteLength(f.data, 'base64'), 0), files.length);
        scan.candidates.push(inspectSkill(base(input.source, scope.scope, real, scope.shared), files));
      } catch (error) {
        if (error instanceof ImportError && error.code === 'limit_exceeded') throw error;
        scan.diagnostics.push(`${entry.name}: ${error instanceof ImportError ? error.message : 'Unable to read skill'}`);
      }
    }
  }
  const configs: Array<{ path: string; scope: ImportScope }> = [{ path: join(root, layout.config.path), scope: 'user' }];
  if (input.projectRoot) configs.push({ path: join(input.projectRoot, layout.projectConfig), scope: 'project' });
  for (const config of configs) {
    if (!existsSync(config.path)) continue;
    try {
      const text = readRegularFile(config.path, 1024 * 1024).toString('utf8');
      const parsed = (layout.config.format === 'toml' ? parseToml(text) : JSON.parse(text)) as Record<string, unknown>;
      if (!input.projectOnly || config.scope === 'project') appendMcp(scan, parsed[layout.config.mcpKey], config.scope, config.path);
      const projects = parsed.projects;
      if (config.scope === 'user' && projects && typeof projects === 'object' && !Array.isArray(projects)) {
        const paths = Object.keys(projects);
        scan.projectRoots = paths;
        if (input.projectRoot) {
          const project = (projects as Record<string, Record<string, unknown>>)[input.projectRoot];
          appendMcp(scan, project?.[layout.config.mcpKey], 'project', config.path);
        }
      }
    } catch { scan.diagnostics.push(`${basename(config.path)}: invalid or unreadable configuration`); }
  }
  const addDocument = (path: string, scope: ImportScope) => {
    if (!existsSync(path)) return;
    try {
      const content = readRegularFile(path, 128 * 1024).toString('utf8').trim();
      if (!content) return;
      consume(Buffer.byteLength(content), 1);
      const blocked = containsSecret(content);
      scan.candidates.push({ ...base(input.source, scope, realpathSync(path)), kind: 'rule', name: basename(path),
        description: '', hash: digest(content), files: [], compatibility: blocked ? 'blocked' : 'compatible',
        findings: blocked ? ['Document contains probable credentials'] : [], requiredEnv: [],
        content: blocked ? undefined : content });
    } catch { scan.diagnostics.push(`${basename(path)}: unable to read context document`); }
  };
  const addInstructions = (directory: string, groups: string[][], scope: ImportScope) => {
    for (const names of groups) {
      const path = names.map(name => join(directory, name)).find(existsSync);
      if (path) addDocument(path, scope);
    }
  };
  const addRules = (directory: string, scope: ImportScope) => {
    if (!existsSync(directory)) return;
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true }).slice(0, 100)) {
        if (entry.isFile() && entry.name.endsWith('.md')) addDocument(join(directory, entry.name), scope);
      }
    } catch { scan.diagnostics.push('Unable to read rules directory'); }
  };
  if (!input.projectOnly) {
    addInstructions(root, layout.instructions, 'user');
    if (layout.rules) addRules(join(root, layout.rules), 'user');
  }
  if (input.projectRoot) {
    addInstructions(input.projectRoot, layout.projectInstructions, 'project');
    if (layout.projectRules) addRules(join(input.projectRoot, layout.projectRules), 'project');
  }
  return scan;
}
