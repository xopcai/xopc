import { pluginCapabilityAccess } from './capability-access.js';
import { pluginAuthorizations, safeAuthorizationUrl } from './setup-contract.js';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import yaml from 'js-yaml';
import { normalizePluginMcpServer } from './mcp-format.js';
import { McpOAuthConfigSchema } from '../../config/schema.js';
import { pluginResources } from './resources.js';
import { readPluginLayout, collectPluginSkillFiles, type PluginLayout } from './formats.js';
import { z } from 'zod';

import { containedPath } from './contained-path.js';

export { containedPath } from './contained-path.js';

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
  z.strictObject({ type: z.literal('streamable-http'), url: z.string().min(1), headers: strings.optional(), oauth: McpOAuthConfigSchema.omit({ clientSecret: true }).optional(), connectionAuth: z.strictObject({ mode: z.enum(['none', 'oauth', 'api-key']), headerName: z.string().optional(), prefix: z.string().optional() }).optional() }),
]);
export type PluginManifest = z.infer<typeof manifestSchema>;
export type PluginServer = z.infer<typeof serverSchema>;
export interface PluginDiagnostic { component: string; message: string }
export interface PluginInspection {
  resources?: ReturnType<typeof pluginResources>;
  layout?: PluginLayout;
  manifest: PluginManifest;
  rootDir: string;
  skills: Array<{ name: string; filePath: string; description?: string }>;
  servers: Record<string, PluginServer>;
  capabilities: string[];
  diagnostics: PluginDiagnostic[];
}

function readPackageFile(root: string, path: string): string {
  const safe = containedPath(root, path);
  const stat = statSync(safe);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Expected a regular file of at most 1 MiB');
  return readFileSync(safe, 'utf8');
}

export function expandPluginVariables(value: string, root: string, data: string): string {
  return value.replace(/\$\{(?:CLAUDE_)?PLUGIN_(ROOT|DATA)\}/g, (_, key) => key === 'ROOT' ? root : data);
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
    } else if (!/^\$\{PLUGIN_RESOURCES\}\/[a-z][a-z0-9.-]{0,63}$/.test(server.command) && !/^[^\s/\\:;|&<>`$\x00-\x1f]+$/.test(server.command)) {
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
    if (server.connectionAuth?.headerName) {
      validateHeaderName(server.connectionAuth.headerName);
      if (['host', 'cookie', 'content-length', 'connection', 'transfer-encoding'].includes(server.connectionAuth.headerName.toLowerCase())) throw new Error('Unsupported authentication header');
    }
    const names = new Set<string>();
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      validateHeaderName(key); validateHeaderValue(key, value);
      if (names.has(key.toLowerCase())) throw new Error('Duplicate case-insensitive header');
      names.add(key.toLowerCase());
    }
  }
  return server;
}

export function inspectAgentPlugin(rootDir: string, dataDir = join(rootDir, '.inspection-data'), importManifest?: Record<string, unknown>): PluginInspection {
  const root = realpathSync(rootDir);
  if (existsSync(join(root, 'xopc.extension.json'))) throw new Error('This package is a native xopc extension');
  if (existsSync(join(root, 'package.json'))) {
    const pkg = JSON.parse(readPackageFile(root, join(root, 'package.json')));
    if (pkg?.xopc?.extension) throw new Error('This package is a native xopc extension');
  }
  const layout = readPluginLayout(root, path => readPackageFile(root, path), path => containedPath(root, path), importManifest);
  const raw: unknown = layout.manifest;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Plugin manifest must be an object');
  const diagnostics: PluginDiagnostic[] = layout.compatibility.filter(item => item.support !== 'supported').map(item => ({ component: item.component, message: item.message }));
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
  const result: PluginInspection = { layout, manifest, rootDir: root, skills: [], servers: Object.create(null), capabilities: [], diagnostics };
  const report = (item: PluginLayout['compatibility'][number]) => { const existing = layout.compatibility.findIndex(value => value.component === item.component); if (existing >= 0) layout.compatibility[existing] = item; else layout.compatibility.push(item); };
  const attempt = (component: string, fn: () => void) => {
    try { fn(); } catch (error) { const message = error instanceof Error ? error.message : String(error); diagnostics.push({ component, message }); report({ component, support: 'invalid', message }); }
  };
  const present = (path: string) => { try { lstatSync(path); return true; } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; } };
  const seenSkills = new Set<string>();
  for (const skillsDir of layout.skillRoots) attempt('skills', () => {
    const files = layout.dialect === 'portable'
      ? readdirSync(skillsDir).sort().map(name => join(skillsDir, name, 'SKILL.md')).filter(present)
      : collectPluginSkillFiles(skillsDir, path => containedPath(root, path));
    for (const file of files) attempt(`skill:${file.slice(root.length + 1)}`, () => {
      const filePath = containedPath(root, file);
      const content = readPackageFile(root, filePath);
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) throw new Error('Skill requires YAML frontmatter');
      const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      const metadata = (layout.dialect === 'portable' ? z.object({
        name: z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().min(1).max(1024), license: z.string().optional(),
        compatibility: z.string().min(1).max(500).optional(), metadata: strings.optional(), 'allowed-tools': z.string().optional(),
      }) : z.object({ name: z.string().min(1).max(64).optional(), description: z.string().min(1).max(1024) })).parse(parsed);
      const name = metadata.name ?? dirname(filePath).split(/[\\/]/).pop()!;
      if (layout.dialect === 'portable' && metadata.name !== dirname(filePath).split(/[\\/]/).pop()) throw new Error('Skill name must match its directory');
      if (!metadata.description.trim() || seenSkills.has(name)) throw new Error('Blank description or duplicate skill name');
      seenSkills.add(name);
      result.skills.push({ name, filePath, description: metadata.description });
      const references = [...new Set(content.match(/\bmcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+|\bfunctions\.(?:exec_command|apply_patch|spawn_agent|send_input|wait_agent)|\$\{(?:CLAUDE_)?PLUGIN_(?:ROOT|DATA|RESOURCES)\}/g) ?? [])].slice(0, 20);
      const message = references.length ? `Host-specific references need execution verification: ${references.join(', ')}` : 'Skill format accepted; business execution is not verified.';
      report({ component: `skill:${name}`, support: references.length ? 'needs_adapter' : 'supported', message });
      if (references.length) diagnostics.push({ component: `skill:${name}`, message });
    });
  });
  for (const rawConfig of layout.mcpConfigs) attempt('mcp', () => {
    const mcp = layout.dialect === 'portable' && present(join(root, 'mcp.json'))
      ? z.strictObject({ $schema: z.literal(MCP_SCHEMA), mcpServers: z.record(z.string(), z.unknown()) }).parse(rawConfig)
      : z.object({ mcpServers: z.record(z.string(), z.unknown()) }).parse(rawConfig);
    for (const [name, value] of Object.entries(mcp.mcpServers)) attempt(`mcp:${name}`, () => {
      delete result.servers[name];
      let incomplete = false;
      const rawServer = normalizePluginMcpServer(value, layout.dialect !== 'portable', message => { incomplete = true; diagnostics.push({ component: `mcp:${name}`, message }); });
      result.servers[name] = validatePluginServer(rawServer, root, dataDir);
      report({ component: `mcp:${name}`, support: incomplete ? 'needs_adapter' : 'supported', message: incomplete ? 'Some MCP declarations require adaptation.' : 'MCP configuration accepted; connection and tools require setup.' });
    });
  });
  for (const skill of result.skills) result.capabilities.push(`content.skills:${skill.name}`);
  for (const [name, server] of Object.entries(result.servers)) {
    result.capabilities.push(server.type === 'stdio'
      ? `runtime.mcp.stdio:${name}:${JSON.stringify(server)}`
      : `network.mcp:${name}:${server.type}:${server.url}:${JSON.stringify(server.headers ?? {})}:${JSON.stringify(server.oauth ?? {})}:${JSON.stringify(server.connectionAuth ?? {})}`);
  }
  attempt('resources', () => {
    result.resources = pluginResources(result);
    for (const resource of result.resources) {
      const supported = (!resource.platform || resource.platform === process.platform) && (!resource.arch || resource.arch === process.arch);
      report({ component: `resource:${resource.id}`, support: supported ? 'supported' : 'unsupported', message: supported ? 'Pinned resource declaration accepted.' : 'Resource does not support this host platform or architecture.' });
      if (!supported) diagnostics.push({ component: `resource:${resource.id}`, message: 'Resource does not support this host platform or architecture.' });
      result.capabilities.push(`${resource.executable ? 'runtime.resource' : 'network.resource'}:${resource.id}:${resource.url}:${resource.sha256}:${resource.maxBytes}:${resource.platform ?? "any"}:${resource.arch ?? "any"}`);
    }
  });
  attempt('authorizations', () => {
    const declarations = pluginAuthorizations(manifest);
    const ids = new Set<string>();
    for (const authorization of declarations) {
      if (ids.has(authorization.id) || authorization.servers.some(name => !result.servers[name])) throw new Error('Invalid or duplicate authorization target');
      ids.add(authorization.id);
      const methods = new Set<string>();
      for (const method of authorization.methods) {
        if (methods.has(method.id)) throw new Error('Duplicate authorization method');
        methods.add(method.id);
        if (method.helpUrl) safeAuthorizationUrl(method.helpUrl);
        if ((method.type === 'form' || method.type === 'cli') && method.fields.some(key => !layout.userConfig[key])) throw new Error('Authorization field is not declared in userConfig');
        if (method.type === 'oauth' && (!authorization.servers.includes(method.server) || result.servers[method.server]?.type === 'stdio')) throw new Error('OAuth requires a remote MCP server');
        if (method.type === 'cli') {
          validatePluginServer({ type: 'stdio', ...method.login }, root, dataDir);
          validatePluginServer({ type: 'stdio', ...method.check }, root, dataDir);
          result.capabilities.push(`runtime.authorization:${authorization.id}:${JSON.stringify(method)}`);
        }
      }
    }
  });
  attempt('capability-access', () => {
    const access = pluginCapabilityAccess(manifest);
    const accounts = new Set(pluginAuthorizations(manifest).map(value => value.id));
    for (const [kind, rules] of Object.entries(access)) for (const [name, rule] of Object.entries(rules)) {
      if (kind === 'skills' ? !result.skills.some(skill => skill.name === name) : !result.servers[name]) throw new Error(`Unknown ${kind} capability: ${name}`);
      if (rule.servers.some(server => !result.servers[server]) || rule.authorizations.some(value => !accounts.has(typeof value === 'string' ? value : value.id))) throw new Error(`Unknown capability dependency: ${name}`);
    }
    if (Object.keys(access.skills).length || Object.keys(access.mcp).length) result.capabilities.push(`runtime.capability-access:${JSON.stringify(access)}`);
  });
  result.capabilities.sort();
  return result;
}

export function pluginServerId(pluginId: string, serverName: string): string {
  return `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_${createHash('sha256').update(JSON.stringify([pluginId, serverName])).digest('hex').slice(0, 16)}`;
}
