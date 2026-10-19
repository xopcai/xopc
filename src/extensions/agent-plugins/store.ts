import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { resolveStateDir } from '../../config/paths-state.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { createLogger } from '../../utils/logger.js';
import { computeExtensionDirectoryIntegrity } from '../lockfile.js';
import { containedPath, inspectAgentPlugin, pluginName, type PluginInspection } from './validation.js';
import { prunePluginResourceCache } from './resources.js';
import { PLUGIN_MANIFEST_PATHS } from './formats.js';
import { pluginSourceKey } from './source-catalog.js';
import type { AgentPluginSourceProvenance } from './sources.js';

const provenanceSchema = z.strictObject({
  kind: z.literal('store'), packageName: pluginName, packageType: z.enum(['plugin', 'extension']),
  version: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  publisherVerification: z.enum(['community', 'verified']).optional(),
  sourceRepository: z.string().url().optional(), sourceCommit: z.string().optional(),
  artifactFormat: z.string().optional(), riskTier: z.enum(['content', 'network', 'local-exec']).optional(),
});

const receiptFields = z.object({
  id: pluginName, revision: z.string().uuid(), source: z.string(), installedAt: z.string(),
  enabled: z.boolean(), integrity: z.string(), capabilities: z.array(z.string()),
  provenance: provenanceSchema.optional(),
  adapterVersion: z.string().min(1).max(64).optional(),
  credentialScope: z.literal('revision').optional(),
  workspacePaths: z.array(z.string()).max(100).optional(),
  resourceHashes: z.array(z.string()).optional(),
  oauthServers: z.record(z.string(), z.string()).optional(),
  importManifest: z.record(z.string(), z.unknown()).optional(),
  resolvedCommit: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  declaredName: pluginName.optional(),

});
const receiptSchema = receiptFields.extend({ previous: receiptFields.optional() });
const log = createLogger('AgentPlugins');
export type PluginReceipt = z.infer<typeof receiptSchema>;
export interface InstalledAgentPlugin extends PluginInspection {
  id: string; format: 'agent-plugin'; receipt: PluginReceipt;
  readiness: 'ready' | 'setup_required' | 'degraded' | 'blocked';
}
export interface PluginInstallPlan extends PluginInspection {
  installId: string; integrity: string; reviewHash: string; addedCapabilities: string[]; installed: boolean;
}

export class AgentPluginStore {
  constructor(readonly stateDir = resolveStateDir()) {}
  private receiptsDir() { return join(this.stateDir, 'plugin-receipts'); }
  revisionKey(): string {
    if (!existsSync(this.receiptsDir())) return '';
    return readdirSync(this.receiptsDir()).filter(name => name.endsWith('.json')).sort()
      .map(name => { try { const setupPath = join(this.stateDir, 'plugin-setup', name); return createHash('sha256').update(readFileSync(join(this.receiptsDir(), name))).update(existsSync(setupPath) ? readFileSync(setupPath) : '').digest('hex'); } catch { return ''; } }).join('|');
  }
  dataDir(id: string) { return containedPath(this.stateDir, join(this.stateDir, 'plugin-data', pluginName.parse(id))); }
  private revisionDir(id: string, revision: string) { return join(this.stateDir, 'plugins', pluginName.parse(id), z.string().uuid().parse(revision)); }
  private receiptPath(id: string) { return join(this.receiptsDir(), `${pluginName.parse(id)}.json`); }
  receipt(id: string): PluginReceipt | undefined {
    const path = this.receiptPath(id);
    if (!existsSync(path)) return undefined;
    const receipt = receiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (receipt.id !== id) throw new Error('Plugin receipt identity mismatch');
    return receipt;
  }
  private write(receipt: PluginReceipt) { writeTextAtomicSync(this.receiptPath(receipt.id), JSON.stringify(receipt)); }
  private mutate<T>(fn: () => T): T {
    mkdirSync(this.receiptsDir(), { recursive: true, mode: 0o700 });
    const release = lockfile.lockSync(this.receiptsDir());
    try { return fn(); } finally { release(); }
  }
  get(id: string): InstalledAgentPlugin | undefined {
    const receipt = this.receipt(id);
    return receipt ? this.fromReceipt(receipt) : undefined;
  }
  private fromReceipt(receipt: PluginReceipt): InstalledAgentPlugin {
    const id = receipt.id;
    const rootDir = this.revisionDir(id, receipt.revision);
    try {
      validatePackageTree(rootDir);
      const inspection = inspectAgentPlugin(rootDir, this.dataDir(id), receipt.importManifest);
      const valid = computeExtensionDirectoryIntegrity(rootDir) === receipt.integrity;
      if (!valid) inspection.diagnostics.push({ component: 'package', message: 'Installed files differ from the reviewed package' });
      const previouslyReviewed = new Set(receipt.capabilities);
      const adapterChanged = receipt.adapterVersion !== undefined && receipt.adapterVersion !== inspection.layout?.adapterVersion;
      const capabilityChanged = inspection.capabilities.some(capability => !previouslyReviewed.has(capability) && !(receipt.adapterVersion === undefined && previouslyReviewed.has(capability.replace(/:\{\}:\{\}$/, ''))));
      if (adapterChanged || capabilityChanged) inspection.diagnostics.push({ component: 'review', message: 'Adapter interpretation changed capabilities. Inspect and review this package again.' });
      const setupPath = join(this.stateDir, 'plugin-setup', `${id}.json`);
      const setup = existsSync(setupPath) ? JSON.parse(readFileSync(setupPath, 'utf8')) : undefined;
      const readiness = !valid || adapterChanged || capabilityChanged || inspection.layout?.compatibility.some(item => item.component === 'hooks' || item.component === 'authorizations' && item.support === 'invalid') ? 'blocked' : setup?.packageRevision === receipt.revision && setup.state !== 'completed' && !setup.installed ? 'setup_required' : inspection.diagnostics.length || setup?.packageRevision === receipt.revision && (setup.partial || setup.installed && (setup.missingConfig?.length || setup.connections?.some((value: { state: string }) => value.state !== 'connected') || setup.authorizations?.some((value: { state: string; issues?: unknown[] }) => value.state !== 'connected' || !!value.issues?.length))) ? 'degraded' : 'ready';
      return { ...inspection, id, receipt, format: 'agent-plugin', readiness };
    } catch (error) {
      return { id, receipt, format: 'agent-plugin', readiness: 'blocked', rootDir,
        manifest: { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: id },
        skills: [], servers: {}, capabilities: [], diagnostics: [{ component: 'package', message: error instanceof Error ? error.message : String(error) }] };
    }
  }
  list(): InstalledAgentPlugin[] {
    if (!existsSync(this.receiptsDir())) return [];
    return readdirSync(this.receiptsDir()).filter(name => name.endsWith('.json')).sort().flatMap(name => {
      const id = name.slice(0, -5);
      if (!pluginName.safeParse(id).success) return [];
      try {
        const plugin = this.get(id);
        return plugin ? [plugin] : [];
      } catch (error) {
        log.warn({ err: error, pluginId: id }, 'Invalid Agent Plugin receipt; package disabled');
        return [];
      }
    });
  }
  active(_agentId?: string, workspaceDir?: string): InstalledAgentPlugin[] {
    if (['1', 'true'].includes(process.env.XOPC_SKIP_EXTENSIONS ?? '')) return [];
    return this.list().filter(p => p.receipt.enabled && p.readiness !== 'blocked' && (p.receipt.workspacePaths === undefined || workspaceDir !== undefined && p.receipt.workspacePaths.includes(existsSync(workspaceDir) ? realpathSync(workspaceDir) : resolve(workspaceDir))) && this.setupReady(p));
  }
  private setupReady(plugin: InstalledAgentPlugin): boolean {
    const path = join(this.stateDir, 'plugin-setup', `${plugin.id}.json`);
    if (!existsSync(path)) return true;
    try { const job = JSON.parse(readFileSync(path, 'utf8')); return job.packageRevision !== plugin.receipt.revision || (job.state === 'completed' || job.installed === true); }
    catch { return false; }
  }
  inspect(source: string, sourceLabel = source, importManifest?: Record<string, unknown>): PluginInstallPlan {
    return this.withSource(source, root => this.plan(root, sourceLabel, importManifest));
  }
  private plan(root: string, sourceLabel: string, importManifest?: Record<string, unknown>): PluginInstallPlan {
    validatePackageTree(root);
    const initial = inspectAgentPlugin(root, undefined, importManifest);
    const existing = this.list().find(p => p.receipt.source === sourceLabel && p.manifest.name === initial.manifest.name);
    const scoped = initial.layout?.dialect !== 'portable' || /^(?:git\+|github:|https:\/\/github\.com\/)/.test(sourceLabel) || sourceLabel.includes('#plugin=');
    const installId = existing?.id ?? (scoped ? `${initial.manifest.name.slice(0, 48).replace(/[.-]+$/, '')}-${pluginSourceKey(sourceLabel)}` : initial.manifest.name);
    const inspection = inspectAgentPlugin(root, this.dataDir(installId), importManifest);
    const integrity = computeExtensionDirectoryIntegrity(root)!;
    const current = this.receipt(installId);
    const addedCapabilities = inspection.capabilities.filter(c => !current?.capabilities.includes(c));
    const reviewHash = createHash('sha256').update(JSON.stringify(['plugin-adapter-v1', integrity, inspection.capabilities, installId, importManifest])).digest('hex');
    return { ...inspection, installId, integrity, reviewHash, addedCapabilities, installed: !!current };
  }
  install(source: string, options: { reviewHash?: string; replace?: boolean; expectedId?: string; sourceLabel?: string; provenance?: AgentPluginSourceProvenance; stage?: boolean; resolvedCommit?: string; importManifest?: Record<string, unknown> } = {}): InstalledAgentPlugin {
    return this.mutate(() => this.withSource(source, root => {
      const plan = this.plan(root, options.sourceLabel ?? source, options.importManifest);
      const id = options.expectedId ?? plan.installId;
      const expected = this.receipt(id);
      if (expected && (expected.declaredName ?? expected.id) !== plan.manifest.name) throw new Error('Update package identity does not match installed plugin');
      if (options.expectedId && !expected) throw new Error('Update package identity does not match installed plugin');
      const current = this.receipt(id);
      if (current && !options.replace) throw new Error('Plugin already installed; use update');
      const changedExecutable = current && current.integrity !== plan.integrity && (plan.capabilities.some(capability => capability.startsWith('runtime.')) || current.capabilities.some(capability => capability.startsWith('runtime.')));
      if ((!current || plan.addedCapabilities.length > 0 || changedExecutable) && options.reviewHash !== plan.reviewHash) throw new Error('Package capability review is required');
      if (options.reviewHash && options.reviewHash !== plan.reviewHash) throw new Error('Package changed after review; inspect again');
      validatePackageTree(root);
      const revision = randomUUID();
      const target = this.revisionDir(id, revision);
      mkdirSync(dirname(target), { recursive: true });
      try {
        cpSync(root, target, { recursive: true, dereference: false, verbatimSymlinks: true });
        // Reject links whose meaning changed after relocation before accepting the snapshot.
        validatePackageTree(target);
        const installed = inspectAgentPlugin(target, this.dataDir(id), options.importManifest);
        const integrity = computeExtensionDirectoryIntegrity(target)!;
        if (integrity !== plan.integrity) throw new Error('Package changed during installation');
        const label = options.sourceLabel ?? source;
        const receipt: PluginReceipt = { id, revision, source: /^(https:\/\/|store:|git\+|github:)/.test(label) ? label : resolve(label), installedAt: new Date().toISOString(),
          declaredName: installed.manifest.name, adapterVersion: installed.layout?.adapterVersion, credentialScope: 'revision', oauthServers: Object.fromEntries(Object.entries(installed.servers).filter(([, server]) => server.type !== 'stdio').map(([name, server]) => [name, server.type !== 'stdio' ? server.url : ''])), importManifest: options.importManifest, resolvedCommit: options.resolvedCommit, workspacePaths: current?.workspacePaths, resourceHashes: plan.resources?.map(resource => resource.sha256), enabled: current?.enabled ?? false, integrity, capabilities: installed.capabilities,
          ...(options.provenance ? { provenance: provenanceSchema.parse(options.provenance) } : {}),
          previous: current ? receiptFields.parse(current) : undefined };
        writeTextAtomicSync(join(this.stateDir, 'plugin-revisions', id, `${revision}.json`), JSON.stringify(receiptFields.parse(receipt)));
        if (options.stage && current) writeTextAtomicSync(this.pendingPath(id), JSON.stringify(receipt));
        else this.write(receipt);
      } catch (error) {
        rmSync(target, { recursive: true, force: true });
        rmSync(join(this.stateDir, 'plugin-revisions', id, `${revision}.json`), { force: true });
        throw error;
      }
      return options.stage && current ? this.pending(id)! : this.get(id)!;
    }));
  }
  history(id: string): InstalledAgentPlugin[] {
    const current = this.receipt(id), pending = this.pending(id);
    const receipts = new Map<string, PluginReceipt>();
    for (const receipt of [current, current?.previous, pending?.receipt]) if (receipt) receipts.set(receipt.revision, receipt);
    const directory = join(this.stateDir, 'plugin-revisions', pluginName.parse(id));
    if (existsSync(directory)) for (const name of readdirSync(directory)) {
      if (!name.endsWith('.json')) continue;
      const receipt = receiptFields.parse(JSON.parse(readFileSync(join(directory, name), 'utf8')));
      if (receipt.id !== id) throw new Error('Plugin history identity mismatch');
      receipts.set(receipt.revision, receipt);
    }
    return [...receipts.values()].map(receipt => this.fromReceipt(receipt));
  }
  /** Publish synchronous resource changes while the package lifecycle lock is held. */
  withRevision<T>(id: string, revision: string, fn: () => T): T {
    return this.mutate(() => {
      if (this.receipt(id)?.revision !== revision && this.pending(id)?.receipt.revision !== revision) throw new Error('Plugin revision changed or was removed');
      return fn();
    });
  }
  private pendingPath(id: string) { return join(this.stateDir, 'plugin-pending', `${pluginName.parse(id)}.json`); }
  pendingReceipt(id: string): PluginReceipt | undefined {
    const path = this.pendingPath(id);
    if (!existsSync(path)) return undefined;
    const receipt = receiptSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (receipt.id !== id) throw new Error('Staged plugin identity mismatch');
    return receipt;
  }
  pending(id: string): InstalledAgentPlugin | undefined {
    const receipt = this.pendingReceipt(id);
    return receipt ? this.fromReceipt(receipt) : undefined;
  }
  commitPending(id: string): void {
    this.mutate(() => {
      const pending = this.pending(id);
      if (!pending) return;
      if (pending.readiness === 'blocked' || pending.receipt.previous?.revision !== this.receipt(id)?.revision) throw new Error('Staged update changed; inspect again');
      this.write(pending.receipt);
      rmSync(this.pendingPath(id), { force: true });
    });
  }
  discardPending(id: string): void {
    this.mutate(() => {
      const pending = this.pending(id);
      if (!pending) return;
      rmSync(this.pendingPath(id), { force: true });
      rmSync(pending.rootDir, { recursive: true, force: true });
      try { const data = this.dataDir(id); rmSync(containedPath(data, join(data, 'resources', pending.receipt.revision)), { recursive: true, force: true }); }
      catch (err) { log.warn({ err, pluginId: id }, 'Could not clean staged plugin resources'); }
      prunePluginResourceCache(this);
    });
  }
  setEnabled(id: string, enabled: boolean): InstalledAgentPlugin {
    return this.mutate(() => {
      const plugin = this.get(id);
      if (!plugin) throw new Error('Plugin not installed');
      if (enabled && plugin.layout?.compatibility.some(item => item.component === 'hooks')) throw new Error('This plugin requires unsupported lifecycle hooks and cannot be enabled by this compatibility version');
      if (enabled && plugin.readiness === 'blocked') throw new Error('Repair the plugin before enabling it');
      this.write({ ...plugin.receipt, enabled });
      return this.get(id)!;
    });
  }
  setWorkspaceScope(id: string, workspacePaths?: string[] | null): InstalledAgentPlugin {
    return this.mutate(() => {
      const plugin = this.get(id);
      if (!plugin) throw new Error('Plugin not installed');
      this.write({ ...plugin.receipt, workspacePaths: workspacePaths === undefined ? plugin.receipt.workspacePaths : workspacePaths === null ? undefined : [...new Set(workspacePaths.map(path => existsSync(path) ? realpathSync(path) : resolve(path)))] });
      return this.get(id)!;
    });
  }
  rollback(id: string): InstalledAgentPlugin {
    return this.mutate(() => {
      const receipt = this.receipt(id);
      const previous = receipt?.previous;
      if (!receipt || !previous || previous.id !== id) throw new Error('No rollback revision available');
      if (computeExtensionDirectoryIntegrity(this.revisionDir(id, previous.revision)) !== previous.integrity) throw new Error('Rollback revision integrity failed');
      this.write({ ...previous, enabled: receipt.enabled, workspacePaths: receipt.workspacePaths, previous: receiptFields.parse(receipt) });
      return this.get(id)!;
    });
  }
  remove(id: string, removeData = false): void {
    this.mutate(() => {
      const receipt = this.receipt(id);
      if (!receipt) throw new Error('Plugin not installed');
      // Stop future discovery before deleting this package's revisions.
      rmSync(this.receiptPath(id));
      rmSync(join(this.stateDir, 'plugins', pluginName.parse(id)), { recursive: true, force: true });
      rmSync(join(this.stateDir, 'plugin-revisions', id), { recursive: true, force: true });
      rmSync(join(this.stateDir, 'plugin-health', id), { recursive: true, force: true });
      rmSync(this.pendingPath(id), { force: true });
      rmSync(join(this.stateDir, 'plugin-setup', `${id}.json`), { force: true });
      if (removeData) rmSync(this.dataDir(id), { recursive: true, force: true });
      prunePluginResourceCache(this);
    });
  }
  private withSource<T>(source: string, fn: (root: string) => T): T {
    const path = resolve(source);
    if (statSync(path).isDirectory()) return fn(path);
    if (statSync(path).size > 50 * 1024 * 1024) throw new Error('Plugin archive exceeds 50 MiB');
    const temp = mkdtempSync(join(tmpdir(), 'xopc-agent-plugin-'));
    try {
      const archive = new AdmZip(path);
      const entries = archive.getEntries();
      if (entries.length > 10000) throw new Error('Too many archive entries');
      let bytes = 0;
      const paths = new Set<string>();
      for (const entry of entries) {
        if (entry.entryName.includes('\\') || entry.entryName.startsWith('/') || /^[a-z]:/i.test(entry.entryName)) throw new Error('Unsafe archive path');
        const target = containedPath(temp, join(temp, entry.entryName));
        if (paths.has(target)) throw new Error('Duplicate archive path');
        paths.add(target);
        const mode = (entry.attr >>> 16) & 0xffff;
        if ((mode & 0xf000) === 0xa000) throw new Error('Archive symlinks are not supported');
        bytes += entry.header.size;
        if (bytes > 100 * 1024 * 1024) throw new Error('Expanded archive exceeds 100 MiB');
        if (entry.isDirectory) mkdirSync(target, { recursive: true });
        else {
          mkdirSync(dirname(target), { recursive: true });
          const data = entry.getData();
          if (data.length !== entry.header.size) throw new Error('Archive size mismatch');
          writeFileSync(target, data, { mode: mode & 0o111 ? 0o755 : 0o644, flag: 'wx' });
        }
      }
      const children = readdirSync(temp);
      const root = PLUGIN_MANIFEST_PATHS.some(path => existsSync(join(temp, path))) ? temp : children.length === 1 ? join(temp, children[0]) : temp;
      return fn(root);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
}

function validatePackageTree(root: string): void {
  let files = 0;
  let bytes = 0;
  const visit = (path: string, ancestors: Set<string>) => {
    const safe = containedPath(root, path);
    if (ancestors.has(safe)) throw new Error('Cyclic package symlink');
    const stat = statSync(safe);
    if (++files > 10000 || (bytes += stat.isFile() ? stat.size : 0) > 100 * 1024 * 1024) throw new Error('Package exceeds limits');
    if (stat.isDirectory()) {
      const next = new Set([...ancestors, safe]);
      for (const name of readdirSync(safe)) visit(join(path, name), next);
    } else if (!stat.isFile()) throw new Error('Unsupported package file type');
    if (lstatSync(path).isFile() && stat.nlink > 1) throw new Error('Package hardlinks are not supported');
  };
  visit(root, new Set());
}
