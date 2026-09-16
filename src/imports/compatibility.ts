import { containsSecret, isCredentialPath } from './secrets.js';
import yaml from 'js-yaml';
import { isValidSkillId } from '../agent/skills/managed-store.js';
import { McpServerSchema } from '../config/schema.js';
import type { ImportCandidate, ImportFile } from './types.js';
import { digest, fileHash } from './files.js';

export function parseSkill(raw: string): { metadata: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match || match[1].length > 64 * 1024) throw new Error('A valid YAML header is required');
  // Aliases are unnecessary for portable skill metadata and can expand recursively.
  if (/(?:^|\s)[&*][\w-]+/.test(match[1])) throw new Error('YAML aliases are not supported');
  let metadata: unknown;
  try { metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); }
  catch { throw new Error('Invalid YAML header'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid skill metadata');
  return { metadata: metadata as Record<string, unknown>, body: match[2] };
}
export function inspectSkill(base: Pick<ImportCandidate, 'id' | 'source' | 'scope' | 'location' | 'shared'>, files: ImportFile[]): ImportCandidate {
  const item: ImportCandidate = { ...base, kind: 'skill', name: base.id, description: '', files, hash: fileHash(files), compatibility: 'compatible', findings: [], requiredEnv: [] };
  try {
    if (files.reduce((n, f) => n + Buffer.byteLength(f.data, 'base64'), 0) > 15 * 1024 * 1024) throw new Error('Skill exceeds 15 MiB');
    if (files.some(f => f.path.endsWith('/SKILL.md'))) throw new Error('Nested skill scopes need separate imports');
    const primary = files.find(f => f.path === 'SKILL.md');
    if (!primary || Buffer.byteLength(primary.data, 'base64') > 1024 * 1024) throw new Error('SKILL.md is missing or exceeds 1 MiB');
    const { metadata, body } = parseSkill(Buffer.from(primary.data, 'base64').toString('utf8'));
    if (typeof metadata.name !== 'string' || !isValidSkillId(metadata.name)) throw new Error('Skill name must be a portable identifier');
    item.name = metadata.name;
    if (typeof metadata.description !== 'string' || !metadata.description.trim() || metadata.description.length > 1024) throw new Error('Skill description must contain 1–1024 characters');
    item.description = metadata.description;
    const supported = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'disable-model-invocation', 'allowed-tools']);
    for (const key of Object.keys(metadata)) if (!supported.has(key)) item.findings.push(`Unsupported skill field: ${key}`);
    if (metadata['disable-model-invocation'] !== undefined && typeof metadata['disable-model-invocation'] !== 'boolean') item.findings.push('disable-model-invocation must be boolean');
    if (/\$ARGUMENTS|\$\{?(?:CLAUDE_|CODEX_)|!`/.test(body)) item.findings.push('Product-specific variables or command expansion require adaptation');
    const meta = metadata.metadata as Record<string, unknown> | undefined;
    if (meta && (typeof meta !== 'object' || Array.isArray(meta))) item.findings.push('Invalid metadata');
    // Unknown nested metadata may encode execution constraints. Do not discard it silently.
    if (meta && Object.keys(meta).some(k => !['author', 'version', 'short-description', 'short_description', 'category', 'tags', 'license', 'homepage'].includes(k))) item.findings.push('Extended metadata needs manual compatibility review');
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const ref = match[1].split('#')[0];
      if (ref && !/^(?:[a-z]+:|#)/i.test(ref) && !files.some(f => f.path === ref.replace(/^\.\//, ''))) item.findings.push('A referenced local file is missing or outside the skill');
    }
    if (item.findings.length) item.compatibility = 'blocked';
    if (metadata['allowed-tools']) item.findings.push('Source tool pre-approvals are not transferred; xopc permissions apply');
    for (const file of files) {
      if (isCredentialPath(file.path) || containsSecret(Buffer.from(file.data, 'base64').toString('utf8'))) {
        item.compatibility = 'blocked';
        item.findings.push('Possible credentials found; remove them from the source and scan again');
        item.files = [];
        item.description = '';
        break;
      }
    }
  } catch (error) {
    item.compatibility = 'blocked';
    item.findings.push(error instanceof Error ? error.message : 'Invalid skill');
  }
  if (files.some(f => containsSecret(Buffer.from(f.data, 'base64').toString('utf8')))) {
    item.files = []; item.description = ''; item.compatibility = 'blocked'; item.findings = ['Possible credentials found; remove them and scan again'];
  }
  return item;
}
export function inspectMcp(base: Pick<ImportCandidate, 'id' | 'source' | 'scope' | 'location' | 'shared'>, name: string, raw: unknown): ImportCandidate {
  const item: ImportCandidate = { ...base, kind: 'mcp', name, description: 'MCP connection draft', files: [], hash: '', compatibility: 'needs_setup', findings: [], requiredEnv: [] };
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const draft: Record<string, unknown> = {};
  const supported = new Set(['command', 'args', 'cwd', 'url', 'type', 'env', 'headers', 'http_headers', 'startup_timeout_sec', 'tool_timeout_sec']);
  for (const [key, v] of Object.entries(value)) {
    if (!supported.has(key)) { item.compatibility = 'blocked'; item.findings.push(`Unsupported MCP field: ${key}`); continue; }
    if (['env', 'headers', 'http_headers'].includes(key)) {
      if (v && typeof v === 'object') item.requiredEnv.push(...Object.keys(v));
      item.findings.push(`${key} values omitted; configure them in xopc`);
    } else if (key === 'type') {
      if (v === 'http') draft.transport = 'streamable-http';
      else if (v === 'sse') draft.transport = 'sse';
      else if (v !== 'stdio') { item.compatibility = 'blocked'; item.findings.push('Unsupported MCP transport'); }
    } else if (key === 'startup_timeout_sec' || key === 'tool_timeout_sec') {
      if (typeof v === 'number') draft[key === 'startup_timeout_sec' ? 'connectionTimeoutMs' : 'requestTimeoutMs'] = v * 1000;
      else { item.compatibility = 'blocked'; item.findings.push('Invalid MCP timeout'); }
    } else draft[key] = v;
  }
  if (typeof draft.url === 'string') {
    try {
      const url = new URL(draft.url);
      if (url.username || url.password || url.search || url.hash) { delete draft.url; item.findings.push('URL credentials or query parameters omitted; enter a clean endpoint'); }
    } catch { delete draft.url; }
  }
  if (containsSecret(JSON.stringify(draft)) || /--?[a-z-]*(?:token|password|secret|api-key|authorization)(?:[=\s\"]|$)/i.test(JSON.stringify(draft))) { Object.keys(draft).forEach(k => delete draft[k]); item.findings.push('Possible credentials omitted from connection fields'); }
  if (!McpServerSchema.safeParse(draft).success || (!draft.command && !draft.url)) { item.compatibility = 'blocked'; item.findings.push('A valid command or URL is required'); }
  if (base.scope === 'project') { item.compatibility = 'blocked'; item.findings.push('Project-scoped MCP activation is not supported'); }
  item.mcp = draft;
  item.hash = digest(draft);
  return item;
}
