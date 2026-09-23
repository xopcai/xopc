import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { readPluginMcpHealth } from './health.js';

const receiptFields = z.object({
  id: pluginName, revision: z.string().uuid(), source: z.string(), installedAt: z.string(),
  enabled: z.boolean(), integrity: z.string(), capabilities: z.array(z.string()),
});
const receiptSchema = receiptFields.extend({ previous: receiptFields.optional() });
const log = createLogger('AgentPlugins');
export type PluginReceipt = z.infer<typeof receiptSchema>;
export interface InstalledAgentPlugin extends PluginInspection {
  id: string; format: 'agent-plugin'; receipt: PluginReceipt;
  readiness: 'ready' | 'setup_required' | 'degraded' | 'blocked';
}
export interface PluginInstallPlan extends PluginInspection {
  integrity: string; reviewHash: string; addedCapabilities: string[]; installed: boolean;
}

export class AgentPluginStore {
  constructor(readonly stateDir = resolveStateDir()) {}
  private receiptsDir() { return join(this.stateDir, 'plugin-receipts'); }
  revisionKey(): string {
    if (!existsSync(this.receiptsDir())) return '';
    return readdirSync(this.receiptsDir()).filter(name => name.endsWith('.json')).sort()
      .map(name => { try { return `${name}:${statSync(join(this.receiptsDir(), name)).mtimeMs}`; } catch { return ''; } }).join('|');
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
    if (!receipt) return undefined;
    const rootDir = this.revisionDir(id, receipt.revision);
    try {
      validatePackageTree(rootDir);
      const inspection = inspectAgentPlugin(rootDir, this.dataDir(id));
      const valid = computeExtensionDirectoryIntegrity(rootDir) === receipt.integrity;
      if (!valid) inspection.diagnostics.push({ component: 'package', message: 'Installed files differ from the reviewed package' });
      const health = Object.keys(inspection.servers).map(name => readPluginMcpHealth(id, name, receipt.revision, this.stateDir));
      const readiness = !valid ? 'blocked' : inspection.diagnostics.length || health.includes('error') ? 'degraded'
        : health.some(status => status !== 'ready') ? 'setup_required' : 'ready';
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
  active(): InstalledAgentPlugin[] {
    if (['1', 'true'].includes(process.env.XOPC_SKIP_EXTENSIONS ?? '')) return [];
    return this.list().filter(p => p.receipt.enabled && p.readiness !== 'blocked');
  }
  inspect(source: string): PluginInstallPlan {
    return this.withSource(source, root => this.plan(root));
  }
  private plan(root: string): PluginInstallPlan {
    validatePackageTree(root);
    const initial = inspectAgentPlugin(root);
    const inspection = inspectAgentPlugin(root, this.dataDir(initial.manifest.name));
    const integrity = computeExtensionDirectoryIntegrity(root)!;
    const current = this.receipt(inspection.manifest.name);
    const addedCapabilities = inspection.capabilities.filter(c => !current?.capabilities.includes(c));
    const reviewHash = createHash('sha256').update(JSON.stringify([integrity, inspection.capabilities])).digest('hex');
    return { ...inspection, integrity, reviewHash, addedCapabilities, installed: !!current };
  }
  install(source: string, options: { reviewHash?: string; replace?: boolean; expectedId?: string; sourceLabel?: string } = {}): InstalledAgentPlugin {
    return this.mutate(() => this.withSource(source, root => {
      const plan = this.plan(root);
      const id = plan.manifest.name;
      if (options.expectedId && options.expectedId !== id) throw new Error('Update package identity does not match installed plugin');
      const current = this.receipt(id);
      if (current && !options.replace) throw new Error('Plugin already installed; use update');
      if ((!current || plan.addedCapabilities.length > 0) && options.reviewHash !== plan.reviewHash) throw new Error('Package capability review is required');
      if (options.reviewHash && options.reviewHash !== plan.reviewHash) throw new Error('Package changed after review; inspect again');
      validatePackageTree(root);
      const revision = randomUUID();
      const target = this.revisionDir(id, revision);
      mkdirSync(dirname(target), { recursive: true });
      try {
        cpSync(root, target, { recursive: true, dereference: false, verbatimSymlinks: true });
        // Reject links whose meaning changed after relocation before accepting the snapshot.
        validatePackageTree(target);
        const installed = inspectAgentPlugin(target, this.dataDir(id));
        const integrity = computeExtensionDirectoryIntegrity(target)!;
        if (integrity !== plan.integrity) throw new Error('Package changed during installation');
        const label = options.sourceLabel ?? source;
        this.write({ id, revision, source: /^(https:\/\/|store:)/.test(label) ? label : resolve(label), installedAt: new Date().toISOString(),
          enabled: current?.enabled ?? false, integrity, capabilities: installed.capabilities,
          previous: current ? receiptFields.parse(current) : undefined });
      } catch (error) {
        rmSync(target, { recursive: true, force: true });
        throw error;
      }
      return this.get(id)!;
    }));
  }
  setEnabled(id: string, enabled: boolean): InstalledAgentPlugin {
    return this.mutate(() => {
      const plugin = this.get(id);
      if (!plugin) throw new Error('Plugin not installed');
      if (enabled && plugin.readiness === 'blocked') throw new Error('Repair the plugin before enabling it');
      this.write({ ...plugin.receipt, enabled });
      return this.get(id)!;
    });
  }
  rollback(id: string): InstalledAgentPlugin {
    return this.mutate(() => {
      const receipt = this.receipt(id);
      const previous = receipt?.previous;
      if (!receipt || !previous || previous.id !== id) throw new Error('No rollback revision available');
      if (computeExtensionDirectoryIntegrity(this.revisionDir(id, previous.revision)) !== previous.integrity) throw new Error('Rollback revision integrity failed');
      this.write({ ...previous, enabled: receipt.enabled, previous: receiptFields.parse(receipt) });
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
      rmSync(join(this.stateDir, 'plugin-health', id), { recursive: true, force: true });
      if (removeData) rmSync(this.dataDir(id), { recursive: true, force: true });
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
      const root = existsSync(join(temp, 'plugin.json')) ? temp : children.length === 1 ? join(temp, children[0]) : temp;
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
