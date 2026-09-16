import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as yieldIO } from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import { resolveStateDir } from '../config/paths.js';
import { ProjectService } from '../projects/project-service.js';
import { ImportSelectionRepository } from '../storage/sqlite/import-selection-repository.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { importContextDocument } from './contextImport.js';
import { existingContext, getLiveInventory } from './inventory.js';
import { canonicalTarget, targetInventory } from './planner.js';
import { digest, fileHash, readRegularFile, readTree } from './files.js';
import type { ImportService } from './importService.js';
import { detectImportSources } from './sources.js';
import { ImportError, type ImportSelection, type StoredInventory, type StoredInventoryItem, type ProductImportResult, type ImportRunItem } from './types.js';

export function listImportSources(owner: string) {
  const runs = new ImportSelectionRepository(owner).list('run');
  return detectImportSources().map(source => ({ ...source, lastImport: runs.find(r => r.source === source.id) }));
}
function stale(): never { throw new ImportError('inventory_stale', 'Selected content or its destination changed. Refresh the list before importing.', 409); }
function selectedItems(inventory: StoredInventory, ids: string[]) {
  if (!ids.length || new Set(ids).size !== ids.length) throw new ImportError('invalid_selection', 'Select at least one item; duplicate selections are not allowed');
  const items = ids.map(id => {
    const item = inventory.candidates.find(c => c.id === id);
    if (!item || item.status === 'blocked' || (item.status === 'existing' && item.kind !== 'project')) throw new ImportError('invalid_selection', 'Select available items from this list');
    if (item.parentId && !ids.includes(item.parentId)) throw new ImportError('missing_parent', 'Select the project entry along with its contents');
    return item;
  });
  return items.sort((a, b) => Number(b.kind === 'project') - Number(a.kind === 'project'));
}
async function preflight(service: ImportService, inventory: StoredInventory, items: StoredInventoryItem[], retry?: ProductImportResult) {
  const projects = new ProjectService();
  const names = new Set<string>();
  for (const item of items) {
    await yieldIO();
    try {
      if (realpathSync(item.location) !== item.location) stale();
      if (item.kind === 'project') {
        if (!statSync(item.location).isDirectory()) stale();
        const existing = projects.findByWorkspaceRoot(item.location);
        const expectedId = item.projectId ?? retry?.items.find(i => i.candidateId === item.id)?.targetId;
        if (existing?.id !== expectedId) stale();
        continue;
      }
      const candidate = item.candidate!;
      const parent = item.parentId ? inventory.candidates.find(c => c.id === item.parentId)! : undefined;
      if (item.kind === 'context') {
        if (digest(readRegularFile(item.location, 128 * 1024).toString('utf8').trim()) !== candidate.hash) stale();
        const projectId = parent ? projects.findByWorkspaceRoot(parent.location)?.id : undefined;
        if ((!parent || projectId) && existingContext(candidate, projectId)) stale();
      } else {
        if (parent && !service.isWorkspaceTrusted(parent.location)) stale();
        if (fileHash(readTree(item.location)) !== candidate.hash) stale();
        service.readSnapshot(item.scanId!, candidate.id);
        if (canonicalTarget(item.targetRoot!) !== item.targetRoot) stale();
        const key = `${item.targetRoot}:${item.targetName!.toLowerCase()}`;
        if (names.has(key)) stale();
        names.add(key);
        const existing = targetInventory(item.targetRoot!);
        const reserved = service.reservedNames({ root: item.targetRoot!, projectId: parent?.projectId });
        if ([...existing.flatMap(e => [e.name, e.directory]), ...reserved].some(n => n.toLowerCase() === item.targetName!.toLowerCase())) stale();
      }
    } catch (error) {
      if (error instanceof ImportError && error.code === 'inventory_stale') throw error;
      stale();
    }
  }
}
function summarize(run: ProductImportResult) {
  run.skills = run.items.filter(i => i.kind === 'skill' && i.status === 'imported').length;
  run.context = run.items.filter(i => i.kind === 'context' && i.status === 'imported').length;
  run.projects = run.items.filter(i => i.kind === 'project' && i.status === 'imported').length;
  run.skipped = run.items.filter(i => i.status === 'existing').length;
  run.issues = run.items.filter(i => i.status === 'failed').map(i => ({ name: i.name, reason: i.error! }));
}
async function execute(service: ImportService, repo: ImportSelectionRepository, inventory: StoredInventory, run: ProductImportResult) {
  const projects = new ProjectService();
  const persist = () => { summarize(run); repo.save('run', run); };
  for (const entry of run.items.filter(i => i.status === 'pending')) {
    await yieldIO();
    const item = inventory.candidates.find(c => c.id === entry.candidateId)!;
    try {
      if (Date.now() - run.createdAt > 30 * 24 * 60 * 60_000) throw new ImportError('expired', 'Import recovery period expired. Scan again.');
      const parent = item.parentId ? run.items.find(i => i.candidateId === item.parentId)! : undefined;
      if (parent?.status === 'failed') throw new ImportError('parent_failed', 'The project could not be imported. Retry the project and its contents.');
      if (item.kind === 'project') {
        if (realpathSync(item.location) !== item.location || !statSync(item.location).isDirectory()) stale();
        runSqliteWriteTransaction(() => {
          const existing = projects.findByWorkspaceRoot(item.location);
          const project = existing ?? projects.create({ workspaceRoot: item.location });
          entry.targetId = project.id; entry.status = existing ? 'existing' : 'imported';
          persist();
        });
      } else if (item.kind === 'context') {
        runSqliteWriteTransaction(() => {
          if (parent && projects.get(parent.targetId!)?.workspaceRoot !== inventory.candidates.find(c => c.id === item.parentId)!.location) stale();
          const status = importContextDocument(item.candidate!, parent?.targetId);
          if (status === 'kept') throw new ImportError('conflict', 'Existing context was kept. Refresh before importing.');
          entry.targetId = existingContext(item.candidate!, parent?.targetId)?.id;
          entry.status = status === 'created' ? 'imported' : 'existing';
          persist();
        });
      } else {
        const key = `${run.id}:${item.id}`;
        let job = service.jobByKey(key);
        if (!job) {
          const plan = service.plan(item.scanId!, { root: item.targetRoot!, projectId: parent?.targetId }, [{ candidateId: item.id,
            operation: item.targetName === item.candidate!.name ? 'create' : 'rename', name: item.targetName }]);
          job = service.apply(plan.id, key);
        }
        entry.jobId = job.id;
        persist();
        job = service.getJob(job.id);
        const pending = job.items.filter(i => ['staged', 'failed'].includes(i.status));
        if (pending.length) {
          try { job = await service.activate(job.id, pending.map(i => i.action.candidateId)); }
          catch (error) {
            job = service.getJob(job.id);
            if (!job.items.every(i => i.status === 'active' || i.status === 'skipped')) throw error;
          }
        }
        const published = job.items[0];
        if (!['active', 'skipped'].includes(published.status)) throw new ImportError('publish_failed', published.error ?? 'Could not publish the skill. Retry this item.');
        entry.targetId = join(item.targetRoot!, item.targetName!);
        entry.status = published.status === 'active' ? 'imported' : 'existing';
      }
    } catch (error) {
      entry.status = 'failed';
      delete entry.targetId;
      entry.error = error instanceof ImportError ? error.message : 'This item could not be imported. Check access and retry.';
    }
    persist();
  }
  run.status = run.items.some(i => i.status === 'failed') ? 'partial' : 'completed';
  persist();
  return run;
}
async function withImportLock<T>(fn: () => Promise<T>): Promise<T> {
  const path = join(resolveStateDir(), 'imports', 'selection-lock');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, { realpath: false, stale: 60_000, retries: { retries: 15, minTimeout: 100, maxTimeout: 500 } });
  try { return await fn(); } finally { await release(); }
}
export async function importSelection(service: ImportService, selection: ImportSelection, owner = 'gateway-owner'): Promise<ProductImportResult> {
  return withImportLock(async () => {
    const repo = new ImportSelectionRepository(owner);
    const selectionHash = digest({ inventoryId: selection.inventoryId, ids: [...selection.candidateIds].sort(), retryOf: selection.retryOf });
    let previous: ProductImportResult | undefined;
    try { previous = repo.get('run', selection.requestId); }
    catch (error) { if (!(error instanceof ImportError) || error.code !== 'not_found') throw error; }
    if (previous) {
      if (previous.selectionHash !== selectionHash) throw new ImportError('conflict', 'Request ID belongs to a different selection', 409);
      return previous.status === 'running' ? execute(service, repo, repo.get('inventory', previous.inventoryId), previous) : previous;
    }
    const inventory = getLiveInventory(owner, selection.inventoryId);
    const items = selectedItems(inventory, selection.candidateIds);
    const retry = selection.retryOf ? repo.get('run', selection.retryOf) : undefined;
    if (retry) {
      if (retry.status !== 'partial' || retry.inventoryId !== inventory.id) throw new ImportError('invalid_selection', 'Select failed items from the original import');
      const failed = new Set(retry.items.filter(i => i.status === 'failed').map(i => i.candidateId));
      const parents = new Set(items.filter(i => failed.has(i.id)).map(i => i.parentId));
      if (!items.some(i => failed.has(i.id)) || items.some(i => !failed.has(i.id) && !parents.has(i.id))) throw new ImportError('invalid_selection', 'Retry can only include failed items and their project entries');
    }
    await preflight(service, inventory, items, retry);
    const run: ProductImportResult = { id: selection.requestId, inventoryId: inventory.id, selectionHash, source: inventory.source,
      createdAt: Date.now(), status: 'running', skills: 0, context: 0, projects: 0, skipped: 0, issues: [],
      items: items.map((item): ImportRunItem => ({ candidateId: item.id, kind: item.kind, name: item.name, status: 'pending' })) };
    repo.save('run', run);
    return execute(service, repo, inventory, run);
  });
}
export async function recoverSelectionRuns(service: ImportService, owner: string) {
  await withImportLock(async () => {
    const repo = new ImportSelectionRepository(owner);
    for (const run of repo.list('run').filter(r => r.status === 'running')) await execute(service, repo, repo.get('inventory', run.inventoryId), run);
    const referenced = new Set(repo.list('run').map(r => r.inventoryId));
    for (const inventory of repo.list('inventory')) {
      if ((!referenced.has(inventory.id) && inventory.expiresAt < Date.now()) || inventory.createdAt < Date.now() - 31 * 24 * 60 * 60_000) {
        for (const scanId of inventory.scanIds) service.discardUnusedScan(scanId);
        repo.deleteInventory(inventory.id);
      }
    }
  });
}
