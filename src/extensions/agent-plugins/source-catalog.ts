import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runExec } from '../../infra/exec.js';
import { PLUGIN_MANIFEST_PATHS } from './formats.js';
import { containedPath } from './validation.js';

export interface PluginCandidate { name: string; source: string; description?: string }
export class PluginSourceRedirect extends Error { constructor(readonly source: string) { super('Resolve marketplace plugin source'); } }
export class PluginSelectionRequired extends Error {
  constructor(readonly candidates: PluginCandidate[]) { super('Select a plugin from this marketplace.'); }
}
export const isGitPluginSource = (source: string) => /^(git\+https:\/\/|git\+ssh:\/\/|github:)/.test(source) || /^https:\/\/github\.com\/[^/]+\/[^/#]+(?:\.git)?(?:#.*)?$/.test(source);

/** Fetch and validate a fixed tree without running hooks, submodules or package scripts. */
export async function withCatalogSource<T>(source: string, fn: (local: string, metadata: { origin: string; commit?: string; importManifest?: Record<string, unknown> }) => T | Promise<T>): Promise<T> {
  const [origin, fragment = ''] = source.split('#', 2);
  const options = new URLSearchParams(fragment);
  const plugin = options.get('plugin');
  const subdir = options.get('path') ?? '.';
  const temp = isGitPluginSource(source) ? mkdtempSync(join(tmpdir(), 'xopc-plugin-git-')) : undefined;
  try {
    let root = origin;
    let commit: string | undefined;
    if (temp) {
      let url = origin.replace(/^git\+/, '').replace(/^github:([^/]+\/[^/]+)$/, 'https://github.com/$1.git');
      const parsed = new URL(url);
      if (!['https:', 'ssh:'].includes(parsed.protocol) || parsed.password || parsed.search || parsed.protocol === 'https:' && parsed.username) throw new Error('Use an HTTPS or SSH Git repository without embedded credentials');
      if (parsed.protocol === 'ssh:' && (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(parsed.hostname) || parsed.username && !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(parsed.username))) throw new Error('Invalid SSH repository host or user');
      url = parsed.href;
      const ref = options.get('ref') ?? 'HEAD';
      if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(ref) || ref.includes('..')) throw new Error('Invalid Git reference');
      const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null' };
      const run = (args: string[]) => runExec('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', ...args], { cwd: temp, env, timeoutMs: 30_000, maxBuffer: 1024 * 1024 });
      await run(['init', '--quiet']);
      await run(['fetch', '--depth=1', '--no-tags', '--', url, ref]);
      commit = (await run(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).stdout.trim();
      const inventory = (await run(['ls-tree', '-r', '-l', commit])).stdout.trim().split('\n').filter(Boolean);
      let expandedBytes = 0;
      if (inventory.length > 10000) throw new Error('Git package exceeds file limit');
      for (const line of inventory) {
        const item = /^(100644|100755) blob [a-f0-9]+\s+(\d+)\t/.exec(line);
        if (!item) throw new Error('Git symlinks and submodules are not supported');
        expandedBytes += Number(item[2]);
        if (expandedBytes > 100 * 1024 * 1024) throw new Error('Git package exceeds 100 MiB');
      }
      // A separate index prevents inherited Git variables from selecting a user's repository.
      await run(['-c', 'core.symlinks=false', 'checkout', '--force', '--detach', commit]);
      rmSync(join(temp, '.git'), { recursive: true, force: true });
      root = temp;
    }
    root = containedPath(root, join(root, subdir));
    let importManifest: Record<string, unknown> | undefined;
    const catalog = options.get('package') === '1' ? undefined : ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json'].map(p => join(root, p)).find(existsSync);
    if (catalog) {
      if (statSync(catalog).size > 1024 * 1024) throw new Error('Marketplace exceeds 1 MiB');
      const manifest = JSON.parse(readFileSync(containedPath(root, catalog), 'utf8'));
      if (!Array.isArray(manifest.plugins) || manifest.plugins.length > 1000) throw new Error('Invalid marketplace plugin list');
      const entries = manifest.plugins as Array<Record<string, unknown>>;
      if (!plugin) throw new PluginSelectionRequired(entries.map(entry => ({ name: String(entry.name), description: typeof entry.description === 'string' ? entry.description : undefined,
        source: `${origin}#${new URLSearchParams({ ...Object.fromEntries(options), plugin: String(entry.name) })}` })));
      const matches = entries.filter(entry => entry.name === plugin);
      if (matches.length !== 1) throw new Error('Marketplace plugin is missing or ambiguous');
      const entry = matches[0];
      const refSource = entry.source;
      let rel: unknown = typeof refSource === 'string' ? refSource : undefined;
      if (refSource && typeof refSource === 'object') {
        const local = refSource as Record<string, unknown>;
        if (local.source === 'local') rel = local.path;
        if (local.source === 'url' && typeof local.url === 'string' && local.url.startsWith('./')) rel = local.url;
      }
      if (typeof refSource === 'object' && refSource) {
        const remote = refSource as Record<string, unknown>;
        if (rel === undefined && (remote.source === 'github' || remote.source === 'url' || remote.source === 'git-subdir')) {
          const target = remote.source === 'github' ? `github:${remote.repo}` : `git+${remote.url}`;
          const query = new URLSearchParams({ package: '1' });
          if (typeof remote.sha === 'string' || typeof remote.ref === 'string') query.set('ref', String(remote.sha ?? remote.ref));
          if (remote.source === 'git-subdir' && typeof remote.path === 'string') query.set('path', remote.path);
          throw new PluginSourceRedirect(`${target}#${query}`);
        }
      }
      if (typeof rel !== 'string' || !rel.startsWith('./') && rel !== '.') throw new Error('This marketplace source type is not supported; install its repository or archive directly');
      root = containedPath(root, join(root, rel));
      const hasManifest = PLUGIN_MANIFEST_PATHS.some(path => existsSync(join(root, path)));
      if (hasManifest && ['skills', 'mcpServers', 'hooks', 'commands', 'agents'].some(key => entry[key] !== undefined)) throw new Error('Marketplace component overlays are not supported by this compatibility version');
      if (!hasManifest && catalog.endsWith('.claude-plugin/marketplace.json')) importManifest = Object.fromEntries(Object.entries(entry).filter(([key]) => !['source', 'strict', 'category', 'tags'].includes(key)));
    } else if (plugin) throw new Error('No marketplace found at this source');
    return await fn(root, { origin: source, commit, importManifest });
  } finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
}

export const pluginSourceKey = (source: string) => {
  if (source.startsWith('store:')) return createHash('sha256').update(source.replace(/@[^/]+$/, '')).digest('hex').slice(0, 12);
  const [origin, fragment = ''] = source.split('#', 2);
  const params = new URLSearchParams(fragment); params.delete('ref'); params.sort();
  const normalized = /^(?:github:|git\+|https:\/\/)/.test(origin) ? origin : existsSync(origin) ? realpathSync(origin) : resolve(origin);
  const canonical = normalized.replace(/^git\+/, '').replace(/^github:([^/]+\/[^/]+)$/, 'https://github.com/$1').replace(/\.git$/, '').replace(/\/$/, '');
  return createHash('sha256').update(`${canonical}#${params}`).digest('hex').slice(0, 12);
};
