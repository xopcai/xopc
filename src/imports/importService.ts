import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import lockfile from 'proper-lockfile';
import yaml from 'js-yaml';
import { prepareManagedSkillTempDir } from '../agent/skills/managed-store.js';
import { writeTextAtomicSync } from '../infra/write-file-atomic.js';
import { ImportRepository } from '../storage/sqlite/import-repository.js';
import { createLogger } from '../utils/logger.js';
import { parseSkill } from './compatibility.js';
import { fileHash, readTree } from './files.js';
import { canonicalTarget, createImportPlan, targetInventory, targetRevision } from './planner.js';
import { scanLocal, type ScanInput } from './scanner.js';
import { ImportError, type ImportAction, type ImportFile, type ImportJob, type ImportJobItem, type ImportScan, type ImportTarget } from './types.js';
const log = createLogger('ImportService');
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export interface ImportServiceOptions {
  stateDir: string;
  owner: string;
  validateTarget?: (target: ImportTarget) => void;
  isConnected?: (candidate: ImportScan['candidates'][number], workspaceRoot?: string) => boolean;
  reservedNames?: (target: ImportTarget) => string[];
  isWorkspaceTrusted?: (root: string) => boolean;
  refreshSkills?: () => void | Promise<void>;
}
export class ImportService {
  private readonly repo: ImportRepository;
  private readonly root: string;
  constructor(private readonly options: ImportServiceOptions) {
    this.repo = new ImportRepository(options.owner);
    this.root = join(canonicalTarget(options.stateDir), 'imports');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  async scan(input: ScanInput): Promise<ImportScan> { return this.storeScan(await scanLocal(input), input.projectRoot); }
  getScan(id: string): ImportScan { return this.repo.get('scan', id); }
  discardUnusedScan(id: string): void {
    this.lock(() => {
      if (this.repo.jobs(-1).some(job => job.plan.scanId === id)) return;
      rmSync(join(this.root, id), { recursive: true, force: true });
      this.repo.deleteScan(id);
    });
  }
  storeScan(scan: ImportScan, workspaceRoot?: string): ImportScan {
    const dir = join(this.root, scan.id);
    mkdirSync(dir, { mode: 0o700 });
    for (const item of scan.candidates) {
      if (item.kind === 'skill' && item.compatibility === 'compatible') {
        writeTextAtomicSync(join(dir, `${item.id}.json`), JSON.stringify(item.files));
      }
    }
    // Persist only the manifest in SQLite; executable bytes remain outside runtime roots.
    const manifest = { ...scan, candidates: scan.candidates.map(c => ({ ...c, connected: this.options.isConnected?.(c, workspaceRoot) ?? false, files: c.files.map(f => ({ ...f, data: '' })) })) };
    this.repo.save('scan', manifest);
    return manifest;
  }
  plan(scanId: string, target: ImportTarget, choices: Array<Pick<ImportAction, 'candidateId' | 'operation'> & { name?: string }>) {
    this.options.validateTarget?.(target);
    const plan = createImportPlan(this.getScan(scanId), target, choices, this.options.reservedNames?.(target));
    this.repo.save('plan', plan);
    return plan;
  }
  describeSkills(scan: ImportScan, target: ImportTarget) {
    const inventory = targetInventory(target.root);
    const names = new Set([...(this.options.reservedNames?.(target) ?? []), ...inventory.flatMap(i => [i.directory, i.name])].map(n => n.toLowerCase()));
    const previous = new Map<string, string>();
    for (const job of this.repo.jobs(-1)) {
      if (job.plan.target.root !== canonicalTarget(target.root)) continue;
      const origin = this.getScan(job.plan.scanId);
      for (const item of job.items.filter(i => i.status === 'active')) {
        const candidate = origin.candidates.find(c => c.id === item.action.candidateId);
        if (candidate?.source === scan.source && !previous.has(candidate.location)) previous.set(candidate.location, item.action.name);
      }
    }
    return scan.candidates.filter(c => c.kind === 'skill').map(candidate => {
      let status: import('./types.js').InventoryStatus = 'ready';
      let reason: string | undefined;
      let targetName = candidate.name;
      if (candidate.connected) status = 'existing';
      else if (candidate.compatibility !== 'compatible') { status = 'blocked'; reason = candidate.findings.join('; '); }
      else {
        const prior = previous.get(candidate.location);
        const priorTarget = prior && inventory.find(i => i.directory === prior);
        const files = this.readSnapshot(scan.id, candidate.id);
        if (priorTarget) {
          targetName = priorTarget.directory;
          status = fileHash(this.renameSkill(files, targetName)) === priorTarget.hash ? 'existing' : 'blocked';
          if (status === 'blocked') reason = 'Previously imported content has changed; existing edits will be kept.';
        } else if (inventory.some(i => i.name.toLowerCase() === candidate.name.toLowerCase() && i.hash === candidate.hash)) status = 'existing';
        else if (names.has(targetName.toLowerCase())) {
          targetName = `${candidate.source}-${candidate.name}`.slice(0, 63);
          if (inventory.some(i => i.name === targetName && i.hash === fileHash(this.renameSkill(files, targetName)))) status = 'existing';
          else if (names.has(targetName.toLowerCase())) { status = 'blocked'; reason = 'Both the original and product-prefixed names are in use.'; }
          else status = 'conflict';
        }
      }
      if (status === 'ready' || status === 'conflict') names.add(targetName.toLowerCase());
      return { candidate, status, reason, targetName };
    });
  }
  readSnapshot(scanId: string, candidateId: string): ImportFile[] {
    const candidate = this.getScan(scanId).candidates.find(c => c.id === candidateId);
    if (!candidate || candidate.kind !== 'skill' || candidate.compatibility !== 'compatible') throw new ImportError('not_found', 'Snapshot not found', 404);
    const files = JSON.parse(readFileSync(join(this.root, scanId, `${candidateId}.json`), 'utf8')) as ImportFile[];
    if (fileHash(files) !== candidate.hash) throw new ImportError('source_changed', 'Snapshot changed', 409);
    return files;
  }
  jobByKey(key: string) { return this.repo.byKey(key); }
  validateTarget(target: ImportTarget) { this.options.validateTarget?.(target); }
  reservedNames(target: ImportTarget) { return this.options.reservedNames?.(target) ?? []; }
  isWorkspaceTrusted(root: string) { return this.options.isWorkspaceTrusted?.(root) ?? false; }
  getPlan(id: string) { return this.repo.get('plan', id); }
  apply(planId: string, key: string): ImportJob {
    if (!key || key.length > 128) throw new ImportError('invalid_key', 'An idempotency key is required');
    return this.lock(() => {
      const previous = this.repo.byKey(key);
      if (previous) {
        if (previous.plan.id !== planId) throw new ImportError('conflict', 'Idempotency key belongs to a different plan', 409);
        return previous;
      }
      const plan = this.getPlan(planId);
      this.options.validateTarget?.(plan.target);
      if (Date.now() > plan.expiresAt || canonicalTarget(plan.target.root) !== plan.target.root || targetRevision(plan.target.root) !== plan.targetRevision) throw new ImportError('plan_stale', 'Target changed or plan expired; preview again', 409);
      const job: ImportJob = { id: randomUUID(), plan, createdAt: Date.now(), expiresAt: Date.now() + RETENTION_MS, items: plan.actions.map(action => ({ action, status: action.operation === 'skip' ? 'skipped' : 'staged' })) };
      const dir = join(this.root, job.id);
      mkdirSync(dir, { mode: 0o700 });
      const scan = this.getScan(plan.scanId);
      try {
        for (const item of job.items) {
          if (item.status === 'skipped') continue;
          const candidate = scan.candidates.find(c => c.id === item.action.candidateId)!;
          if (candidate.kind !== 'skill') continue;
          const files = JSON.parse(readFileSync(join(this.root, scan.id, `${candidate.id}.json`), 'utf8')) as ImportFile[];
          if (fileHash(files) !== candidate.hash) throw new ImportError('source_changed', 'Snapshot changed; scan again', 409);
          const rewritten = this.renameSkill(files, item.action.name);
          item.afterHash = fileHash(rewritten);
          writeTextAtomicSync(join(dir, `${candidate.id}.json`), JSON.stringify(rewritten));
        }
        this.repo.save('job', job, key);
      } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
      log.info({ jobId: job.id, count: job.items.length }, 'Import staged');
      return job;
    });
  }
  private renameSkill(files: ImportFile[], name: string): ImportFile[] {
    return files.map(file => {
      if (file.path !== 'SKILL.md') return file;
      const raw = Buffer.from(file.data, 'base64').toString('utf8');
      const { metadata, body } = parseSkill(raw);
      if (metadata.name === name) return file;
      return { ...file, data: Buffer.from(`---\n${yaml.dump({ ...metadata, name })}---\n${body}`).toString('base64') };
    });
  }
  getJob(id: string): ImportJob { return this.lock(() => this.recover(this.repo.get('job', id))); }
  async recoverAndClean(): Promise<void> {
    const release = await lockfile.lock(this.root, { realpath: false, retries: { retries: 15, minTimeout: 250, maxTimeout: 1000 } });
    try {
      for (const saved of this.repo.jobs(-1)) {
        const job = this.recover(saved);
        if (Date.now() <= job.expiresAt || canonicalTarget(job.plan.target.root) !== job.plan.target.root) continue;
        for (const item of job.items) {
          if (item.backupPath && existsSync(item.backupPath) && this.targetHash(item.backupPath) === item.action.beforeHash) rmSync(item.backupPath, { recursive: true, force: true });
        }
        rmSync(join(this.root, job.id), { recursive: true, force: true });
      }
      for (const scan of this.repo.scansBefore(Date.now() - RETENTION_MS - 24 * 60 * 60 * 1000)) rmSync(join(this.root, scan.id), { recursive: true, force: true });
    } finally { await release(); }
  }
  history(): ImportJob[] { return this.lock(() => this.repo.jobs().map(job => this.recover(job))); }
  async activate(id: string, candidateIds: string[]): Promise<ImportJob> {
    const job = this.lock(() => {
      const current = this.recover(this.repo.get('job', id));
      this.assertLive(current);
      this.options.validateTarget?.(current.plan.target);
      const scan = this.getScan(current.plan.scanId);
      this.checkSelection(current, candidateIds);
      for (const candidateId of candidateIds) {
        const item = current.items.find(i => i.action.candidateId === candidateId)!;
        if (item.status === 'active') continue;
        if (!['staged', 'failed'].includes(item.status)) throw new ImportError('invalid_state', 'Item cannot be activated');
        const candidate = scan.candidates.find(c => c.id === candidateId)!;
        if (candidate.kind !== 'skill') throw new ImportError('needs_setup', 'Review the MCP draft in connection settings before configuring it');
        try { this.publish(current, item); }
        catch (error) { if (item.status !== 'publishing') item.status = 'failed'; item.error = error instanceof ImportError ? error.message : 'Publishing failed; retry after checking target permissions'; }
        this.repo.save('job', current);
      }
      return current;
    });
    await this.options.refreshSkills?.();
    return job;
  }
  private publish(job: ImportJob, item: ImportJobItem): void {
    const root = job.plan.target.root;
    if (canonicalTarget(root) !== root) throw new ImportError('unsafe_target', 'Target location changed', 409);
    const dest = join(root, item.action.name);
    const currentHash = this.targetHash(dest);
    if (currentHash !== item.action.beforeHash) throw new ImportError('plan_stale', 'Target changed after preview', 409);
    // Recheck all logical names, including inherited skills, immediately before publication.
    const others = this.options.reservedNames?.(job.plan.target) ?? [];
    if (item.action.operation !== 'replace' && others.some(name => name.toLowerCase() === item.action.name.toLowerCase())) throw new ImportError('conflict', 'Skill name is now in use', 409);
    const files = JSON.parse(readFileSync(join(this.root, job.id, `${item.action.candidateId}.json`), 'utf8')) as ImportFile[];
    if (fileHash(files) !== item.afterHash) throw new ImportError('source_changed', 'Staged files changed', 409);
    const { tempDir } = prepareManagedSkillTempDir(item.action.name, root);
    try {
      for (const file of files) {
        const path = join(tempDir, file.path);
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, Buffer.from(file.data, 'base64'), { mode: file.executable ? 0o700 : 0o600, flag: 'wx' });
      }
      if (fileHash(readTree(tempDir)) !== item.afterHash) throw new ImportError('source_changed', 'Staged verification failed', 409);
      item.backupPath = join(root, `.tmp-import-backup-${job.id}-${item.action.candidateId}`);
      item.status = 'publishing';
      delete item.error;
      this.repo.save('job', job);
      if (existsSync(dest)) renameSync(dest, item.backupPath);
      renameSync(tempDir, dest);
      item.status = 'active';
    } catch (error) {
      if (item.backupPath && existsSync(item.backupPath) && !existsSync(dest)) renameSync(item.backupPath, dest);
      throw error;
    } finally { rmSync(tempDir, { recursive: true, force: true }); }
  }
  async rollback(id: string, candidateIds: string[]): Promise<ImportJob> {
    const job = this.lock(() => {
      const current = this.recover(this.repo.get('job', id));
      this.assertLive(current);
      this.checkSelection(current, candidateIds);
      for (const candidateId of candidateIds) {
        const item = current.items.find(i => i.action.candidateId === candidateId)!;
        if (['rolled_back', 'skipped'].includes(item.status)) continue;
        if (item.status === 'staged' || item.status === 'failed') { item.status = 'rolled_back'; this.repo.save('job', current); continue; }
        const dest = join(current.plan.target.root, item.action.name);
        if (canonicalTarget(current.plan.target.root) !== current.plan.target.root || this.targetHash(dest) !== item.afterHash) {
          item.error = 'Target changed after import; rollback would overwrite your edits';
          this.repo.save('job', current);
          continue;
        }
        if (item.action.beforeHash !== null && (!item.backupPath || this.targetHash(item.backupPath) !== item.action.beforeHash)) {
          item.error = 'Backup is missing or changed; manual review required'; this.repo.save('job', current); continue;
        }
        item.status = 'rolling_back';
        this.repo.save('job', current);
        const trash = this.trashPath(current, item);
        renameSync(dest, trash);
        if (item.backupPath && existsSync(item.backupPath)) {
          if (this.targetHash(item.backupPath) !== item.action.beforeHash) throw new ImportError('rollback_conflict', 'Backup changed; manual review required', 409);
          renameSync(item.backupPath, dest);
        }
        item.status = 'rolled_back';
        delete item.error;
        this.repo.save('job', current);
        rmSync(trash, { recursive: true, force: true });
      }
      return current;
    });
    await this.options.refreshSkills?.();
    return job;
  }
  private trashPath(job: ImportJob, item: ImportJobItem) { return join(job.plan.target.root, `.tmp-import-undo-${job.id}-${item.action.candidateId}`); }
  private recover(job: ImportJob): ImportJob {
    for (const item of job.items) {
      if (!['publishing', 'rolling_back'].includes(item.status)) continue;
      const root = job.plan.target.root;
      if (canonicalTarget(root) !== root) throw new ImportError('unsafe_target', 'Target location changed', 409);
      const dest = join(root, item.action.name);
      const hash = this.targetHash(dest);
      if (item.status === 'publishing') {
        if (hash === item.afterHash) item.status = 'active';
        else if (hash === item.action.beforeHash) item.status = 'staged';
        else if (!hash && item.action.beforeHash !== null && item.backupPath && this.targetHash(item.backupPath) === item.action.beforeHash) { renameSync(item.backupPath, dest); item.status = 'staged'; }
        else { item.status = 'failed'; item.error = 'Publication interrupted and target changed; manual review required'; }
      } else {
        const trash = this.trashPath(job, item);
        if (!hash && item.action.beforeHash !== null && item.backupPath && this.targetHash(item.backupPath) === item.action.beforeHash) renameSync(item.backupPath, dest);
        else if (hash === item.afterHash && !existsSync(trash)) { item.status = 'active'; this.repo.save('job', job); continue; }
        else if (hash !== item.action.beforeHash) { item.error = 'Rollback interrupted; target needs review'; this.repo.save('job', job); continue; }
        item.status = 'rolled_back';
        rmSync(trash, { recursive: true, force: true });
      }
      this.repo.save('job', job);
    }
    return job;
  }
  private targetHash(path: string): string | null {
    if (!existsSync(path)) return null;
    if (canonicalTarget(path) !== path || lstatSync(path).isSymbolicLink()) throw new ImportError('unsafe_target', 'Target is a symbolic link', 409);
    return fileHash(readTree(path));
  }
  private assertLive(job: ImportJob): void {
    if (Date.now() > job.expiresAt) throw new ImportError('expired', 'Import recovery period has expired', 409);
  }
  private checkSelection(job: ImportJob, ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !job.items.some(i => i.action.candidateId === id))) throw new ImportError('invalid_selection', 'Select valid import items');
  }
  private lock<T>(run: () => T): T {
    const release = lockfile.lockSync(this.root, { realpath: false });
    try { return run(); } finally { release(); }
  }
}
