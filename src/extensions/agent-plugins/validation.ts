import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

export const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
export const pluginName = z.string().min(1).max(64).regex(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
const manifestSchema = z.object({
  $schema: z.literal(PLUGIN_SCHEMA), name: pluginName,
  version: z.string().optional(), description: z.string().optional(),
  author: z.strictObject({ name: z.string().optional(), email: z.string().optional(), url: z.string().optional() }).optional(),
  homepage: z.string().optional(), repository: z.string().optional(), license: z.string().optional(),
  keywords: z.array(z.string()).optional(), extensions: z.record(z.string(), z.unknown()).optional(),
});
const strings = z.record(z.string(), z.string());
const serverSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('stdio'), command: z.string().min(1), args: z.array(z.string()).optional(), env: strings.optional(), cwd: z.string().optional() }),
  z.strictObject({ type: z.literal('streamable-http'), url: z.string().min(1), headers: strings.optional() }),
  z.strictObject({ type: z.literal('sse'), url: z.string().min(1), headers: strings.optional() }),
]);
export type PluginManifest = z.infer<typeof manifestSchema>;
export type PluginServer = z.infer<typeof serverSchema>;
export interface PluginDiagnostic { component: string; message: string }
export interface PluginInspection {
  manifest: PluginManifest;
  rootDir: string;
  skills: Array<{ name: string; filePath: string }>;
  servers: Record<string, PluginServer>;
  capabilities: string[];
  diagnostics: PluginDiagnostic[];
}

export function containedPath(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(path);
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error('Path escapes package boundary');
  }
  // Resolve existing ancestors as well as leaves: PLUGIN_DATA may not exist yet.
  let ancestor = target;
  while (!existsSync(ancestor)) {
    try { lstatSync(ancestor); throw new Error('Broken package symlink'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(ancestor) === ancestor) break;
    ancestor = dirname(ancestor);
  }
  let baseAncestor = base;
  while (!existsSync(baseAncestor)) baseAncestor = dirname(baseAncestor);
  const canonicalBase = resolve(realpathSync(baseAncestor), relative(baseAncestor, base));
  const canonicalTarget = resolve(realpathSync(ancestor), relative(ancestor, target));
  const resolvedRelative = relative(canonicalBase, canonicalTarget);
  if (resolvedRelative === '..' || resolvedRelative.startsWith('../') || resolvedRelative.startsWith('..\\') || isAbsolute(resolvedRelative)) {
    throw new Error('Resolved path escapes package boundary');
  }
  return canonicalTarget;
}

function readPackageFile(root: string, path: string): string {
  const safe = containedPath(root, path);
  const stat = statSync(safe);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Expected a regular file of at most 1 MiB');
  return readFileSync(safe, 'utf8');
}

export function expandPluginVariables(value: string, root: string, data: string): string {
  return value.replace(/\$\{PLUGIN_(ROOT|DATA)\}/g, (_, key) => key === 'ROOT' ? root : data);
}

export function resolvePluginCwd(cwd: string | undefined, root: string, data: string): string {
  if (cwd === undefined) return root;
  const dataRooted = /^\$\{PLUGIN_DATA\}(?:\/|$)/.test(cwd);
  if (!dataRooted && !/^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$))/.test(cwd)) throw new Error('Invalid MCP cwd');
  return containedPath(dataRooted ? data : root, resolve(root, expandPluginVariables(cwd, root, data)));
}

export function validatePluginServer(raw: unknown, root: string, data: string): PluginServer {
  const server = serverSchema.parse(raw);
  if (server.type === 'stdio') {
    if (server.command.startsWith('./')) {
      if (!statSync(containedPath(root, resolve(root, server.command))).isFile()) throw new Error('MCP command must be a file');
    } else if (!/^[^\s/\\:;|&<>`$\x00-\x1f]+$/.test(server.command)) {
      throw new Error('MCP command must be one bare executable or ./package-path');
    }
    for (const key of Object.keys(server.env ?? {})) {
      if (['PLUGIN_ROOT', 'PLUGIN_DATA'].includes(process.platform === 'win32' ? key.toUpperCase() : key)) throw new Error('Reserved plugin environment variable');
      if (!key || /[=\0]/.test(key)) throw new Error('Invalid environment name');
    }
    if ([...(server.args ?? []), ...Object.values(server.env ?? {}), server.command, server.cwd ?? ''].some((value) => value.includes('\0'))) throw new Error('NUL in process configuration');
    resolvePluginCwd(server.cwd, root, data);
  } else {
    const url = new URL(server.url);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !loopback) || url.username || url.password || server.url.includes('#')) throw new Error('Remote MCP requires HTTPS (HTTP is allowed on loopback), without user information or fragments');
    const names = new Set<string>();
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      validateHeaderName(key); validateHeaderValue(key, value);
      if (names.has(key.toLowerCase())) throw new Error('Duplicate case-insensitive header');
      names.add(key.toLowerCase());
    }
  }
  return server;
}

export function inspectAgentPlugin(rootDir: string, dataDir = join(rootDir, '.inspection-data')): PluginInspection {
  const root = realpathSync(rootDir);
  if (existsSync(join(root, 'xopc.extension.json'))) throw new Error('This package is a native xopc extension');
  if (existsSync(join(root, 'package.json'))) {
    const pkg = JSON.parse(readPackageFile(root, join(root, 'package.json')));
    if (pkg?.xopc?.extension) throw new Error('This package is a native xopc extension');
  }
  const raw: unknown = JSON.parse(readPackageFile(root, join(root, 'plugin.json')));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plugin manifest must be an object');
  const diagnostics: PluginDiagnostic[] = [];
  const cleaned = { ...raw } as Record<string, unknown>;
  for (const key of Object.keys(cleaned)) if (!Object.hasOwn(manifestSchema.shape, key)) {
    diagnostics.push({ component: 'manifest', message: `Ignored unknown field: ${key}` });
    delete cleaned[key];
  }
  if ('extensions' in cleaned && (!cleaned.extensions || typeof cleaned.extensions !== 'object' || Array.isArray(cleaned.extensions))) {
    diagnostics.push({ component: 'manifest', message: 'Ignored non-object extensions field' });
    delete cleaned.extensions;
  }
  const manifest = manifestSchema.parse(cleaned);
  const result: PluginInspection = { manifest, rootDir: root, skills: [], servers: Object.create(null), capabilities: [], diagnostics };
  const attempt = (component: string, fn: () => void) => {
    try { fn(); } catch (error) { diagnostics.push({ component, message: error instanceof Error ? error.message : String(error) }); }
  };
  const present = (path: string) => { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } };
  const skillsDir = join(root, 'skills');
  if (present(skillsDir)) attempt('skills', () => {
    const safe = containedPath(root, skillsDir);
    if (!statSync(safe).isDirectory()) throw new Error('skills must be a directory');
    for (const name of readdirSync(safe).sort()) attempt(`skill:${name}`, () => {
      const dir = containedPath(root, join(safe, name));
      if (!statSync(dir).isDirectory() || !present(join(dir, 'SKILL.md'))) return;
      const filePath = containedPath(root, join(dir, 'SKILL.md'));
      const content = readPackageFile(root, filePath);
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw new Error('Skill requires YAML frontmatter');
      const metadata = z.object({
        name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().min(1).max(1024), license: z.string().optional(),
        compatibility: z.string().min(1).max(500).optional(), metadata: strings.optional(), 'allowed-tools': z.string().optional(),
      }).parse(yaml.load(match[1], { schema: yaml.JSON_SCHEMA }));
      if (metadata.name !== name || !metadata.description.trim()) throw new Error('Skill name must match its directory and description must not be blank');
      result.skills.push({ name, filePath });
    });
  });
  const mcpPath = join(root, 'mcp.json');
  if (present(mcpPath)) attempt('mcp', () => {
    const mcp = z.strictObject({ $schema: z.literal(MCP_SCHEMA), mcpServers: z.record(z.string(), z.unknown()) }).parse(JSON.parse(readPackageFile(root, mcpPath)));
    for (const [name, rawServer] of Object.entries(mcp.mcpServers)) attempt(`mcp:${name}`, () => {
      result.servers[name] = validatePluginServer(rawServer, root, dataDir);
    });
  });
  for (const skill of result.skills) result.capabilities.push(`content.skills:${skill.name}`);
  for (const [name, server] of Object.entries(result.servers)) {
    result.capabilities.push(server.type === 'stdio'
      ? `runtime.mcp.stdio:${name}:${JSON.stringify(server)}`
      : `network.mcp:${name}:${server.type}:${server.url}:${JSON.stringify(server.headers ?? {})}`);
  }
  result.capabilities.sort();
  return result;
}

export function pluginServerId(pluginId: string, serverName: string): string {
  return `plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(serverName)}`;
}
