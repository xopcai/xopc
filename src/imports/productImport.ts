import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, parse } from 'node:path';
import lockfile from 'proper-lockfile';
import { resolveStateDir } from '../config/paths.js';
import { ProjectService } from '../projects/project-service.js';
import { ImportRepository } from '../storage/sqlite/import-repository.js';
import { importContextDocument } from './contextImport.js';
import type { ImportService } from './importService.js';
import { resolveImportTarget } from './runtime.js';
import { detectImportSources } from './sources.js';
import { ImportError, type ImportScan, type ImportSource, type ProductImportResult } from './types.js';

export function listImportSources(owner: string) {
  const runs = new ImportRepository(owner).latestRuns();
  return detectImportSources().map(source => ({ ...source, lastImport: runs.find(r => r.source === source.id) }));
}

/** One product action. Destination services retain their existing scope and trust policies. */
export async function importProduct(service: ImportService, source: ImportSource, requestId: string = randomUUID(), owner = 'gateway-owner'): Promise<ProductImportResult> {
  const root = join(resolveStateDir(), 'imports', 'product-import');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(root, { realpath: false, retries: { retries: 10, minTimeout: 100, maxTimeout: 500 } });
  const repo = new ImportRepository(owner);
  try {
    try {
      const previous = repo.get('run', requestId);
      if (previous.source !== source) throw new ImportError('conflict', 'Request belongs to another product', 409);
      return previous;
    } catch (error) { if (!(error instanceof ImportError) || error.code !== 'not_found') throw error; }
    if (!detectImportSources().some(s => s.id === source && s.detected)) throw new ImportError('source_not_found', 'This app is no longer available on the xopc device', 404);
    const result: ProductImportResult = { id: requestId, source, createdAt: Date.now(), skills: 0, context: 0, projects: 0, skipped: 0, issues: [] };
    const budget = { bytes: 0, files: 0 };
    const scan = service.scan({ source, budget });
    const saveContext = (items: ImportScan['candidates'], projectId?: string) => {
      for (const item of items.filter(c => c.kind === 'rule' && c.scope === (projectId ? 'project' : 'user'))) {
        if (!item.content || item.compatibility !== 'compatible') {
          result.issues.push({ name: item.name, reason: item.findings.join('; ') }); continue;
        }
        try {
          const status = importContextDocument(item, projectId);
          if (status === 'created') result.context++;
          else if (status === 'unchanged') result.skipped++;
          else result.issues.push({ name: item.name, reason: 'Existing context was kept. The source document has changed.' });
        } catch { result.issues.push({ name: item.name, reason: 'Unable to save this context document. Try again.' }); }
      }
    };
    const importScope = async (scopeScan: ImportScan, projectId?: string) => {
      const scoped = { ...scopeScan, candidates: scopeScan.candidates.filter(c => c.scope === (projectId ? 'project' : 'user')) };
      result.issues.push(...scopeScan.diagnostics.map(reason => ({ name: source, reason })));
      saveContext(scoped.candidates, projectId);
      for (const item of scoped.candidates.filter(c => c.kind === 'mcp')) result.issues.push({ name: item.name, reason: 'Reconnect this tool in Connections; credentials and executable settings are not transferred.' });
      try {
        const skills = await service.importSkills(scoped, resolveImportTarget(projectId));
        result.skills += skills.imported; result.skipped += skills.skipped; result.issues.push(...skills.issues);
      } catch (error) {
        result.issues.push({ name: projectId ? 'Project skills' : 'Skills', reason: error instanceof ImportError ? error.message : 'Unable to import skills. Try again.' });
      }
    };
    await importScope(scan);
    const projects = new ProjectService();
    const seen = new Set<string>();
    for (const path of scan.projectRoots ?? []) {
      try {
        if (!isAbsolute(path) || parse(path).root === path || !statSync(path).isDirectory()) throw new Error('Invalid project');
        const workspaceRoot = realpathSync(path);
        if (seen.has(workspaceRoot)) continue;
        seen.add(workspaceRoot);
        let project = projects.findByWorkspaceRoot(workspaceRoot);
        if (!project) { project = projects.create({ workspaceRoot }); result.projects++; }
        else result.skipped++;
        await importScope(service.scan({ source, projectRoot: workspaceRoot, projectOnly: true, budget }), project.id);
      } catch {
        result.issues.push({ name: path, reason: 'Project unavailable; existing content was kept.' });
      }
    }
    repo.save('run', result);
    return result;
  } finally { await release(); }
}
