import { createHash, randomUUID } from 'node:crypto';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { basename, resolve } from 'node:path';

import { z } from 'zod';

import { McpDraftError, type McpConnectionDrafts } from '../../../agent/mcp/connection-drafts.js';
import type { McpAuthorization, McpConnectionProbe } from '../../../agent/mcp/connection-setup.js';
import { isPrivateMcpTarget, isPublicMcpTarget, suggestsPrivateMcpHostname } from '../../../agent/mcp/network-policy.js';
import { McpServerSchema, type McpServerConfig } from '../../../config/schema.js';
import { isRecord } from '../../../utils/is-record.js';
import type { Command, Field, Panel, PanelAction, Translator } from './mobile-capability-panels.js';

const TTL_MS = 10 * 60_000;
const AUTHORIZATION_HEADER = 'authorization';
const transportHeaders = new Set([
  'accept', 'connection', 'content-length', 'content-type', 'expect', 'host', 'keep-alive', 'last-event-id',
  'mcp-protocol-version', 'mcp-session-id', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const oauthSchema = z.strictObject({
  clientId: z.string().trim().min(1).max(512).optional(),
  clientSecret: z.string().trim().min(1).max(4096).optional(),
  clientName: z.string().trim().min(1).max(128).optional(),
  clientRegistration: z.enum(['dcr', 'cimd']).optional(),
  scope: z.string().trim().max(512).optional(),
});
const authSchema = z.enum(['auto', 'none', 'bearer', 'apiKey', 'headers', 'oauth']);
const urlTransport = z.enum(['http', 'streamable-http', 'sse']);
const networkSchema = z.enum(['auto', 'private']);
const envName = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const isProcessText = (value: string) => !value.includes('\0') && !value.includes('\r') && !value.includes('\n');
const executionSchema = z.object({
  command: z.string().trim().min(1).max(1024).refine(isProcessText),
  args: z.array(z.string().max(4096).refine(value => !value.includes('\0'))).max(64).optional(),
  cwd: z.string().trim().max(2048).refine(isProcessText).optional(),
});
const commonImportKeys = ['type', 'displayName', 'description', 'timeout', 'exposure', 'toolExposure', 'enabled'];
const httpImportKeys = [...commonImportKeys, 'url', 'headers', 'oauth', 'network'];
const stdioImportKeys = [...commonImportKeys, 'command', 'args', 'cwd', 'env'];
type McpSetupHost = { allowStdio: boolean; workspace: string };

type AuthMethod = z.infer<typeof authSchema>;
type Candidate = {
  id: string;
  name: string;
  server: McpServerConfig & { displayName: string };
};
type Phase = 'preview' | 'review' | 'auth' | 'retry' | 'oauth' | 'authorizing' | 'verified' | 'saved';
type Flow = {
  id: string;
  owner: string;
  phase: Phase;
  revision: number;
  busy: boolean;
  timer?: ReturnType<typeof setTimeout>;
  candidates?: Candidate[];
  unsupported?: number;
  selected?: Candidate;
  candidate?: Candidate;
  method?: AuthMethod;
  reviewed?: boolean;
  draftId?: string;
  toolCount?: number;
  receipt?: { action: string; revision: number; panel: Panel };
  rejectedHeaders?: boolean;
};

function serverAddress(value: unknown, network: z.infer<typeof networkSchema>, t: Translator): { url: string; xopcPrivateNetwork: boolean } {
  const parsed = z.url().max(2048).safeParse(typeof value === 'string' ? value.trim() : value);
  if (parsed.success) {
    const url = new URL(parsed.data);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) {
      const privateNetwork = network === 'private' || url.protocol === 'http:' || suggestsPrivateMcpHostname(url.hostname);
      if (privateNetwork ? isPrivateMcpTarget(url) : isPublicMcpTarget(url)) {
        return { url: url.href, xopcPrivateNetwork: privateNetwork };
      }
    }
  }
  throw new McpDraftError(400, t(
    '请输入公共 HTTPS 或 Gateway 内网 HTTP(S) 地址。地址中请勿包含账号、查询参数或片段。',
    'Enter a public HTTPS or Gateway-private HTTP(S) address without credentials, query parameters, or a fragment.',
  ));
}

function environment(entries: [string, string][], t: Translator): Record<string, string> {
  const names = new Set<string>();
  return Object.fromEntries(entries.filter(([name, value]) => name.trim() || value).map(([name, value]) => {
    const key = name.trim();
    const normalized = key.toUpperCase();
    if (entries.length > 32 || !envName.test(key) || key.length > 128 || value.length > 4096 || value.includes('\0') ||
        ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(normalized) || names.has(normalized)) {
      throw new McpDraftError(400, t('请检查环境变量名称、值及重复项。', 'Check the environment variable names, values, and duplicates.'));
    }
    names.add(normalized);
    return [key, value];
  }));
}

function keyValueRows(raw: string | undefined, t: Translator): [string, string][] {
  let input: unknown;
  try { input = raw ? JSON.parse(raw) : []; } catch { input = undefined; }
  const parsed = z.array(z.tuple([z.string(), z.string()])).safeParse(input);
  if (!parsed.success) throw new McpDraftError(400, t('请检查键值配置。', 'Check the name and value pairs.'));
  return parsed.data.map(([name, value]): [string, string] => [name!, value!]);
}

function headerMap(entries: [string, string][], t: Translator): Record<string, string> {
  const seen = new Set<string>();
  if (!entries.length || entries.length > 16) {
    throw new McpDraftError(400, t('请填写 1 至 16 个请求头。', 'Enter between 1 and 16 request headers.'));
  }
  return Object.fromEntries(entries.map(([key, raw]) => {
    const name = key.trim();
    const value = raw.trim();
    const normalized = name.toLowerCase();
    try {
      validateHeaderName(name);
      validateHeaderValue(name, value);
      if (name.length > 128 || value.length > 4096 || !value || seen.has(normalized) || transportHeaders.has(normalized) ||
          ['__proto__', 'constructor', 'prototype'].includes(normalized)) throw new Error();
    } catch {
      throw new McpDraftError(400, t('请检查请求头的名称、值及重复项。', 'Check the header names, values, and duplicates.'));
    }
    seen.add(normalized);
    return [name, value];
  }));
}

function bearerHeaders(raw: string | undefined, t: Translator): Record<string, string> {
  const token = raw?.trim().replace(/^Bearer\s+/i, '') ?? '';
  if (!/^[!-~]+$/.test(token) || token.length > 4096) {
    throw new McpDraftError(400, t('请输入服务商提供的 Bearer 令牌。', 'Enter the Bearer token provided by the service.'));
  }
  return { Authorization: `Bearer ${token}` };
}

function importedHeaderEntries(value: unknown, t: Translator): [string, string][] {
  const parsed = z.record(z.string(), z.string()).safeParse(value);
  if (!parsed.success) throw new McpDraftError(400, t('请求头的值应为文本。', 'Header values must be text.'));
  return Object.entries(parsed.data);
}

function candidateId(label: string, identity: string, importId: string): string {
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(importId) && !['__proto__', 'constructor', 'prototype'].includes(importId.toLowerCase())) return importId;
  const slug = label.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 42);
  const hash = createHash('sha256').update(importId ? JSON.stringify([identity, importId]) : identity).digest('hex').slice(0, 12);
  return slug + '-' + hash;
}

function linkCandidate(address: ReturnType<typeof serverAddress>, name: string, overrides: Partial<McpServerConfig> = {}, importId = ''): Candidate {
  const { url, xopcPrivateNetwork } = address;
  const host = new URL(url).hostname;
  const displayName = name || host;
  return { id: candidateId(host, url, importId), name: displayName, server: {
    type: 'http', ...overrides, url, displayName, xopcPublicOnly: !xopcPrivateNetwork, xopcPrivateNetwork,
  } };
}

function stdioCandidate(execution: unknown, name: string, host: McpSetupHost, t: Translator,
  overrides: Partial<McpServerConfig> = {}, env?: Record<string, string>, importId = ''): Candidate {
  const parsed = executionSchema.safeParse(execution);
  if (!parsed.success) throw new McpDraftError(400, t('请检查可执行程序、参数和工作目录。', 'Check the executable, arguments, and working directory.'));
  const { command, args = [], cwd } = parsed.data;
  const directory = resolve(host.workspace, cwd || '.');
  const executable = basename(command.replaceAll('\\', '/'));
  const displayName = name || executable || command;
  const signature = JSON.stringify([command, args, directory]);
  return { id: candidateId(executable || 'stdio', signature, importId), name: displayName,
    server: { ...overrides, type: 'stdio', command, args, cwd: directory, env, displayName, xopcManagedStdio: true } };
}

function importCandidates(raw: string | undefined, host: McpSetupHost, t: Translator): { candidates: Candidate[]; unsupported: number } {
  let input: unknown;
  try { input = JSON.parse(raw ?? ''); }
  catch { throw new McpDraftError(400, t('JSON 格式有误，请检查后重试。', 'The JSON is invalid. Check the syntax and try again.')); }
  if (!isRecord(input)) throw new McpDraftError(400, t('请粘贴一个 MCP 配置对象。', 'Paste an MCP configuration object.'));
  const collection = input.mcpServers ?? (isRecord(input.mcp) ? input.mcp.servers : undefined) ?? input.servers;
  if (collection !== undefined && !isRecord(collection)) {
    throw new McpDraftError(400, t('服务列表必须是 JSON 对象。', 'The server list must be a JSON object.'));
  }
  const entries = collection ? Object.entries(collection) : [['', input] as const];
  const candidates: Candidate[] = [];
  let firstError: unknown;
  for (const [key, item] of entries) {
    try {
      if (!isRecord(item)) throw new McpDraftError(400, t('每个服务都需要一个配置对象。', 'Each server needs a configuration object.'));
      const { type, displayName, description, timeout, exposure, toolExposure, enabled } = item;
      const stdio = Object.hasOwn(item, 'command') || type === 'stdio';
      if (Object.keys(item).some(field => !(stdio ? stdioImportKeys : httpImportKeys).includes(field)) ||
          type !== undefined && (stdio ? type !== 'stdio' : !urlTransport.safeParse(type).success)) {
        throw new McpDraftError(400, t('此配置包含不兼容的传输方式或字段。', 'This configuration mixes incompatible transports or fields.'));
      }
      const assignedName = z.string().trim().max(64).safeParse(displayName ?? key.slice(0, 64));
      if (!assignedName.success) throw new McpDraftError(400, t('请检查服务名称。', 'Check the server name.'));
      const shared = { description, timeout, exposure, toolExposure, enabled };
      if (stdio) {
        const base = McpServerSchema.safeParse({ ...shared, command: item.command, type: 'stdio' });
        if (!base.success) throw new McpDraftError(400, t('请检查命令服务配置。', 'Check the stdio server configuration.'));
        const rawEnv = z.record(z.string(), z.string()).optional().safeParse(item.env);
        if (!rawEnv.success) throw new McpDraftError(400, t('环境变量的值应为文本。', 'Environment variable values must be text.'));
        const env = rawEnv.data ? environment(Object.entries(rawEnv.data), t) : undefined;
        candidates.push(stdioCandidate(item, assignedName.data, host, t, base.data, env, key));
        continue;
      }
      const network = networkSchema.safeParse(item.network ?? 'auto');
      if (!network.success) throw new McpDraftError(400, t('请检查网络范围。', 'Check the network scope.'));
      const address = serverAddress(item.url, network.data, t);
      const base = McpServerSchema.safeParse({ ...shared, url: address.url, type });
      const oauthConfig = oauthSchema.optional().safeParse(item.oauth);
      if (!base.success || !oauthConfig.success) {
        throw new McpDraftError(400, t('请检查配置字段和 OAuth 设置。', 'Check the configuration fields and OAuth settings.'));
      }
      const entries = item.headers === undefined ? [] : importedHeaderEntries(item.headers, t);
      const staticHeaders = entries.length ? headerMap(entries, t) : undefined;
      if (oauthConfig.data && Object.keys(staticHeaders ?? {}).some(name => name.toLowerCase() === AUTHORIZATION_HEADER)) {
        throw new McpDraftError(400, t('OAuth 配置不能同时指定 Authorization 请求头。', 'An OAuth configuration cannot also specify an Authorization header.'));
      }
      candidates.push(linkCandidate(address, assignedName.data, {
        ...base.data, type: base.data.type ?? 'http', headers: staticHeaders, oauth: oauthConfig.data,
      }, key));
    } catch (error) {
      if (!(error instanceof McpDraftError)) throw error;
      firstError ??= error;
    }
  }
  if (!candidates.length) {
    throw firstError ?? new McpDraftError(400, t('配置中没有可添加的服务。', 'The configuration has no servers to add.'));
  }
  return { candidates, unsupported: entries.length - candidates.length };
}

function entry(t: Translator, options: {
  source?: 'link' | 'json' | 'stdio';
  candidate?: Candidate;
  method?: AuthMethod;
  message?: string;
  allowStdio?: boolean;
} = {}): Panel {
  const server = options.candidate?.server;
  const link = { field: 'mcp-mode', value: 'link' };
  const json = { field: 'mcp-mode', value: 'json' };
  const stdio = { field: 'mcp-mode', value: 'stdio' };
  return {
    message: options.message,
    ...(options.allowStdio === false ? {
      copyable: {
        label: t('先在电脑端启用命令启动', 'Enable command launch on Gateway first'),
        content: 'xopc config set gateway.mobileMcpAllowStdio true',
        note: t('当前 Gateway 未允许移动端命令启动。请先在电脑终端执行上方命令，再返回审阅并添加。',
          'Mobile command launch is currently disabled on the Gateway. Run the command above on your computer, then return here.'),
        visibleWhen: stdio,
      },
    } : {}),
    fields: [
      { id: 'mcp-mode', label: t('添加方式', 'Add method'), type: 'select', presentation: 'segmented',
        value: options.source ?? 'link', options: [
          { id: 'link', label: t('服务链接', 'Server URL') }, { id: 'json', label: t('粘贴 JSON', 'Paste JSON') },
          { id: 'stdio', label: t('命令启动', 'Command') },
        ] },
      { id: 'url', label: t('服务地址', 'Server URL'), type: 'text', format: 'url', required: true,
        value: typeof server?.url === 'string' ? server.url : '',
        hint: 'https://example.com/mcp',
        description: t('支持公网 HTTPS 或 Gateway 所在内网的 HTTP(S) 地址。', 'Supports public HTTPS or Gateway private-network HTTP(S) URLs.'),
        visibleWhen: link },
      { id: 'mcp-json', label: t('MCP JSON 配置', 'MCP JSON configuration'), type: 'multiline', format: 'json', required: true, retain: true,
        hint: '{ "mcpServers": { … } }',
        description: t('可直接粘贴 Claude Desktop、Cursor 或服务文档里的 JSON 配置片段。', 'Paste a JSON snippet from Claude Desktop, Cursor, or MCP server docs.'),
        visibleWhen: json },
      { id: 'command', label: t('可执行程序', 'Executable'), type: 'text', format: 'code', required: true, value: server?.command ?? '',
        hint: t('Gateway 上的程序名称或路径', 'Program name or path on the Gateway'),
        description: t('运行在 Gateway 主机上的程序名或绝对路径（如 npx、uvx、node）。', 'Program name or path on the Gateway host (for example: npx, uvx, node).'),
        visibleWhen: stdio },
      { id: 'args', label: t('参数（选填）', 'Arguments (optional)'), type: 'multiline', format: 'code', value: server?.args?.join('\n') ?? '',
        hint: t('每行一个参数，空格会保留', 'One argument per line. Spaces are preserved.'),
        description: t('每个参数占一行，无需手动添加引号。', 'Enter one argument per line without extra quotes.'),
        visibleWhen: stdio },
      { id: 'id', label: t('名称（选填）', 'Name (optional)'), type: 'text', value: options.candidate?.name ?? '',
        hint: t('默认使用服务域名', 'Defaults to the server domain'), advanced: true, visibleWhen: link },
      { id: 'transport', label: t('传输协议', 'Transport'), type: 'select', value: server?.type === 'sse' ? 'sse' : 'http',
        advanced: true, visibleWhen: link, options: [
          { id: 'http', label: 'Streamable HTTP' }, { id: 'sse', label: t('旧版 SSE', 'Legacy SSE') },
        ] },
      { id: 'network', label: t('网络范围', 'Network scope'), type: 'select', value: server?.xopcPrivateNetwork ? 'private' : 'auto',
        advanced: true, visibleWhen: link, options: [
          { id: 'auto', label: t('自动识别', 'Detect automatically') }, { id: 'private', label: t('Gateway 内网', 'Gateway private network') },
        ] },
      { id: 'authMethod', label: t('认证方式', 'Authentication'), type: 'select', value: options.method ?? 'auto',
        description: t('不确定时保持「自动探测」，系统会自动识别是否需要 OAuth 或访问密钥。', 'Keep Detect automatically if unsure; the Gateway will detect OAuth or API keys.'),
        visibleWhen: link, options: authOptions(t) },
      { id: 'commandName', label: t('名称（选填）', 'Name (optional)'), type: 'text',
        value: options.source === 'stdio' ? options.candidate?.name : '', advanced: true, visibleWhen: stdio },
      { id: 'cwd', label: t('工作目录（选填）', 'Working directory (optional)'), type: 'text', format: 'code', value: server?.cwd ?? '',
        hint: t('默认使用 Gateway 工作区', 'Defaults to the Gateway workspace'), advanced: true, visibleWhen: stdio },
      { id: 'mcp-env', label: t('环境变量（选填）', 'Environment variables (optional)'), type: 'headers', retain: true,
        keyLabel: t('变量名', 'Variable name'), valueLabel: t('变量值', 'Variable value'),
        keyPlaceholder: 'API_KEY', addLabel: t('添加变量', 'Add variable'), maxItems: 32,
        advanced: true, visibleWhen: stdio },
    ],
    advancedLabel: t('高级设置', 'Advanced settings'),
    detailsLabel: t('连接与数据说明', 'Connection and data'),
    details: t('检查由 Gateway 执行。使用工具时，任务数据可能发送给服务；命令模式会在 Gateway 主机启动程序。',
      'The Gateway performs the check. Tool usage may send task data to the service. Command mode starts a program on the Gateway host.'),
    actions: [
      { id: 'create', label: t('检查连接', 'Check connection'), visibleWhen: link },
      { id: 'preview', label: t('预览配置', 'Preview configuration'), visibleWhen: json },
      { id: 'review-command', label: t('审阅命令', 'Review command'), visibleWhen: stdio },
    ],
  };
}

function authOptions(t: Translator): NonNullable<Field['options']> {
  return [
    { id: 'auto', label: t('自动探测', 'Detect automatically') },
    { id: 'oauth', label: t('OAuth 浏览器授权', 'OAuth in browser') },
    { id: 'bearer', label: 'Bearer Token' },
    { id: 'apiKey', label: 'API Key' },
    { id: 'headers', label: t('自定义请求头', 'Custom request headers') },
    { id: 'none', label: t('无需认证', 'No authentication') },
  ];
}

function backAction(t: Translator): PanelAction {
  return { id: 'edit', label: t('返回配置', 'Back to configuration') };
}

function reviewSummary(candidate: Candidate | undefined, t: Translator): Partial<Panel> {
  if (!candidate) return {};
  const { server } = candidate;
  const transport = server.type === 'sse' ? t('旧版 SSE', 'Legacy SSE') : 'Streamable HTTP';
  const network = server.xopcPrivateNetwork ? t('Gateway 内网', 'Gateway private network') : transport;
  return { headline: candidate.name, subtitle: typeof server.url === 'string'
    ? `${server.url} · ${network}${server.xopcPrivateNetwork && server.type === 'sse' ? ` · ${transport}` : ''}`
    : t('在 Gateway 上运行 · stdio', 'Runs on the Gateway · stdio') };
}

export function createMobileMcpSetup(drafts: McpConnectionDrafts, readHost: () => McpSetupHost,
  publish: (owner: string, draftId: string, enable: boolean, stdio: boolean, t: Translator) => ReturnType<McpConnectionDrafts['commit']>) {
  const flows = new Map<string, Flow>();

  function clearDraft(flow: Flow) {
    if (flow.draftId) drafts.remove(flow.owner, flow.draftId);
    flow.draftId = undefined;
    flow.toolCount = undefined;
  }

  function renew(flow: Flow, expiresAt = Date.now() + TTL_MS) {
    clearTimeout(flow.timer);
    flow.timer = setTimeout(() => {
      if (flow.busy) { renew(flow, Date.now() + 1000); return; }
      clearDraft(flow);
      flows.delete(flow.id);
    }, Math.max(1, expiresAt - Date.now()));
    flow.timer.unref();
  }

  function newFlow(owner: string, t: Translator): Flow {
    const owned = [...flows.values()].filter(flow => flow.owner === owner);
    if (owned.filter(flow => flow.phase !== 'saved').length >= 8) {
      const idle = owned.find(flow => !flow.busy && flow.phase !== 'authorizing' && flow.phase !== 'saved');
      if (idle) {
        clearTimeout(idle.timer);
        clearDraft(idle);
        flows.delete(idle.id);
      }
    }
    if (flows.size >= 100 || [...flows.values()].filter(flow => flow.owner === owner && flow.phase !== 'saved').length >= 8) {
      throw new McpDraftError(429, t('未完成的配置过多，请稍后重试。', 'Too many unfinished configurations. Try again shortly.'));
    }
    const id = randomUUID();
    const flow: Flow = { id, owner, phase: 'preview', revision: 1, busy: false };
    flows.set(id, flow);
    renew(flow);
    return flow;
  }

  function preview(flow: Flow, t: Translator): Panel {
    const candidates = flow.candidates ?? [];
    const skipped = flow.unsupported ?? 0;
    return {
      flow: flow.id,
      headline: t('选择服务', 'Choose a server'),
      message: skipped
        ? t(`每次添加一个服务。另有 ${skipped} 项配置在移动端不可用。`, `Add one server at a time. ${skipped} other configurations are unavailable on mobile.`)
        : t('每次添加一个服务。', 'Add one server at a time.'),
      fields: [{ id: 'selection', label: t('服务', 'Server'), type: 'select',
        value: String(Math.max(0, candidates.indexOf(flow.selected ?? candidates[0]))), options: candidates.map((item, index) => ({
          id: String(index),
          label: `${item.name} · ${typeof item.server.url === 'string' ? item.server.url.replace(/^https?:\/\//, '').slice(0, 112)
            : t('命令启动', 'Command')}`,
        })) }],
      actions: [{ id: 'select', label: t('检查所选连接', 'Check selected connection') }, backAction(t)],
    };
  }

  function needsAuth(flow: Flow, t: Translator, message?: string): Panel {
    flow.phase = 'auth';
    const initial = flow.method && flow.method !== 'auto' && flow.method !== 'oauth'
      ? flow.method : flow.rejectedHeaders ? 'headers' : '';
    const apiKey = { field: 'method', value: 'apiKey' };
    const previousKeyHeader = flow.method === 'apiKey' ? Object.keys(flow.candidate?.server.headers ?? {})[0] : undefined;
    return {
      flow: flow.id,
      ...reviewSummary(flow.candidate, t),
      message: message ?? t('填写服务商提供的凭据。', 'Enter the credentials provided by the service.'),
      steps: [
        t('按服务商文档选择对应的认证方式并填写凭据。', 'Choose the authentication method specified by the provider and enter your credentials.'),
        t('凭据会加密保存在 Gateway，点击「检查连接」验证后即可添加。', 'Credentials are encrypted on the Gateway. Tap Check connection to verify before adding.'),
      ],
      fields: [
        { id: 'method', label: t('认证方式', 'Authentication'), type: 'select', required: true, value: initial, options: [
          { id: '', label: t('选择认证方式', 'Choose an authentication method') }, ...authOptions(t),
        ] },
        { id: 'token', label: 'Bearer Token', type: 'secret', required: true,
          description: t('填写服务商颁发的访问令牌，无需手动加 Bearer 前缀。', 'Enter the access token; the Bearer prefix is added automatically.'),
          visibleWhen: { field: 'method', value: 'bearer' } },
        { id: 'apiKeyHeader', label: t('API Key 请求头名称', 'API Key header name'), type: 'text', required: true,
          value: previousKeyHeader ?? 'X-API-Key', hint: 'X-API-Key', visibleWhen: apiKey },
        { id: 'apiKey', label: 'API Key', type: 'secret', required: true, visibleWhen: apiKey },
        { id: 'requestHeaders', label: t('请求头', 'Request headers'), type: 'headers',
          keyLabel: t('请求头名称', 'Header name'), valueLabel: t('请求头值', 'Header value'),
          keyPlaceholder: 'X-API-Key', addLabel: t('添加请求头', 'Add header'), maxItems: 16,
          visibleWhen: { field: 'method', value: 'headers' } },
      ],
      actions: [{ id: 'verify', label: t('检查连接', 'Check connection') }, backAction(t)],
    };
  }

  function oauthReady(flow: Flow, t: Translator, message?: string): Panel {
    flow.phase = 'oauth';
    return { flow: flow.id, ...reviewSummary(flow.candidate, t),
      message: message ?? t('在服务商页面登录并授权。', 'Sign in and authorize access on the provider’s website.'),
      steps: [
        t('点击下方「打开浏览器授权」登录服务商账号。', 'Tap Authorize in browser to sign in with the provider.'),
        t('授权完成后切回本应用，系统会自动检测并加载工具列表。', 'Return to this app after authorizing; connection verification runs automatically.'),
      ],
      actions: [{ id: 'authorize', label: t('打开浏览器授权', 'Authorize in browser') },
        { id: 'change-auth', label: t('更改认证方式', 'Change authentication') }, backAction(t)] };
  }

  function verified(flow: Flow, t: Translator, toolCount: number): Panel {
    flow.phase = 'verified';
    flow.toolCount = toolCount;
    return {
      flow: flow.id, ...reviewSummary(flow.candidate, t), tone: 'success',
      message: toolCount === 0 ? t('连接检查通过 · 未发现工具', 'Connection verified · No tools found')
        : t(`连接检查通过 · 发现 ${toolCount} 个工具`, `Connection verified · ${toolCount} tools found`),
      actions: [{ id: 'save', label: t('添加连接', 'Add connection') }, backAction(t)],
    };
  }

  function retry(flow: Flow, t: Translator, result: McpConnectionProbe): Panel {
    flow.phase = 'retry';
    const stdio = flow.candidate?.server.type === 'stdio';
    const message = stdio
      ? t('程序未通过 MCP 检查。请核对 Gateway 上的可执行程序、工作目录和依赖。',
        'The program did not pass the MCP check. Verify the executable, working directory, and dependencies on the Gateway.')
      : result.errorCode === 'rate_limited'
      ? t('服务请求过于频繁，请稍后重试。', 'The service is rate limiting requests. Try again shortly.')
      : result.errorCode === 'not_found' || result.errorCode === 'invalid_response'
        ? t('此地址未返回有效的 MCP 响应，请核对服务地址。', 'This address did not return a valid MCP response. Check the URL.')
        : result.errorCode === 'access_denied'
          ? t('服务拒绝访问，请检查凭据或访问权限。', 'Access was denied. Check your credentials or access permissions.')
          : t('无法连接到此服务，请检查地址和网络后重试。', 'Could not reach this service. Check the URL and network, then try again.');
    return { flow: flow.id, ...reviewSummary(flow.candidate, t), message,
      actions: [{ id: 'retry', label: stdio ? t('再次运行并检查', 'Run and check again') : t('重新检查', 'Check again') }, backAction(t)] };
  }

  function review(flow: Flow, candidate: Candidate, t: Translator): Panel {
    flow.phase = 'review';
    const { server } = candidate;
    const stdio = server.type === 'stdio';
    const command = JSON.stringify([server.command, ...(server.args ?? [])]);
    const variables = Object.keys(server.env ?? {});
    const message = stdio
      ? t('确认后，Gateway 会在主机上启动下面的程序并读取工具列表。', 'Confirm to start the program on the Gateway host and list its tools.')
      : t('此地址由 Gateway 所在网络访问。localhost 指向 Gateway 主机。', 'The Gateway accesses this address from its own network. Localhost refers to the Gateway host.');
    const details = stdio ? [
      command, t(`工作目录  ${server.cwd}`, `Working directory  ${server.cwd}`),
      ...(variables.length ? [t(`环境变量  ${variables.join(', ')}`, `Environment variables  ${variables.join(', ')}`)] : []),
    ].join('\n') : undefined;
    return { flow: flow.id, ...reviewSummary(candidate, t), message,
      reviewText: details,
      actions: [{ id: 'confirm-check', label: stdio ? t('运行并检查', 'Run and check') : t('检查内网连接', 'Check private connection') }, backAction(t)] };
  }

  async function probe(flow: Flow, t: Translator): Promise<Panel> {
    if (flow.candidate?.server.type === 'stdio') assertMobileStdioAllowed(readHost().allowStdio, t);
    const result = await drafts.probe(flow.owner, flow.draftId!);
    if (result.state === 'connected') return verified(flow, t, result.toolCount ?? 0);
    if (result.state === 'oauth_required' && flow.method !== 'none') return oauthReady(flow, t);
    if (result.state === 'oauth_required' || result.state === 'token_required' || result.state === 'auth_unknown' ||
        (flow.candidate?.server.url && result.errorCode === 'access_denied')) {
      const hasCredentials = Object.keys(flow.candidate?.server.headers ?? {}).length > 0;
      flow.rejectedHeaders = hasCredentials;
      return needsAuth(flow, t, hasCredentials
        ? t('服务拒绝了访问。请检查凭据和权限，或切换认证方式。', 'Access was denied. Check your credentials and permissions, or choose another authentication method.')
        : t('此服务要求认证。请根据服务商的说明选择认证方式。', 'This service requires authentication. Choose the method specified by the provider.'));
    }
    return retry(flow, t, result);
  }

  async function start(flow: Flow, candidate: Candidate, method: AuthMethod, t: Translator): Promise<Panel> {
    flow.candidate = candidate;
    flow.method = method;
    flow.reviewed = false;
    if (candidate.server.type === 'stdio') assertMobileStdioAllowed(readHost().allowStdio, t);
    if (candidate.server.type === 'stdio' || candidate.server.xopcPrivateNetwork) return review(flow, candidate, t);
    return connect(flow, t);
  }

  async function connect(flow: Flow, t: Translator): Promise<Panel> {
    const method = flow.method;
    if (method === 'apiKey' || method === 'headers' || (method === 'bearer' && !flow.candidate?.server.headers)) return needsAuth(flow, t);
    return testDraft(flow, t);
  }

  async function testDraft(flow: Flow, t: Translator): Promise<Panel> {
    const candidate = flow.candidate!;
    if ((candidate.server.type === 'stdio' || candidate.server.xopcPrivateNetwork) && !flow.reviewed) {
      throw new McpDraftError(409, t('请先审阅连接。', 'Review the connection first.'));
    }
    if (candidate.server.type === 'stdio') assertMobileStdioAllowed(readHost().allowStdio, t);
    clearDraft(flow);
    flow.phase = 'retry';
    try {
      const draft = await drafts.create(flow.owner, { serverId: candidate.id, server: candidate.server }, { protectCredentials: true });
      flow.draftId = draft.id;
      renew(flow, draft.expiresAt);
      return flow.method === 'oauth' ? oauthReady(flow, t) : await probe(flow, t);
    } catch (error) {
      if (!(error instanceof McpDraftError) || error.status !== 409) throw error;
      return { flow: flow.id, ...reviewSummary(candidate, t),
        message: t('此服务已添加，请返回修改地址或选择其他配置。', 'This server is already added. Go back to change the URL or select another configuration.'),
        actions: [backAction(t)] };
    }
  }

  function authorization(flow: Flow, t: Translator, result: McpAuthorization): Panel {
    if (result.state === 'connected') return verified(flow, t, result.toolCount ?? 0);
    if (result.state === 'error' || result.state === 'cancelled') {
      return oauthReady(flow, t, t('授权未完成，可以重试或返回配置。', 'Authorization did not finish. Try again or go back.'));
    }
    flow.phase = 'authorizing';
    let authorizationUrl: string | undefined;
    if (result.authorizationUrl) {
      authorizationUrl = browserAuthorizationUrl(result.authorizationUrl, flow.candidate?.server);
      if (!authorizationUrl) return oauthReady(flow, t, t('服务未提供可用的授权链接。', 'The provider did not return a usable authorization link.'));
    }
    return { flow: flow.id, ...reviewSummary(flow.candidate, t), authorizationUrl, pollAction: 'status',
      message: t('请在浏览器完成授权，返回后将自动检查连接。', 'Finish authorization in the browser. The connection will be checked when you return.'),
      fields: result.acceptsRedirect ? [{ id: 'callback', label: t('浏览器最后打开的地址', 'Final browser address'),
        type: 'secret', advanced: true, hint: t('仅在授权未自动完成时使用', 'Use only if authorization does not finish automatically') }] : undefined,
      actions: [backAction(t), ...(result.acceptsRedirect ? [{
        id: 'callback', label: t('完成授权', 'Finish authorization'), advanced: true,
      }] : [])] };
  }

  return async function mobileMcpSetup(owner: string, t: Translator, command?: Command): Promise<Panel> {
    if (!command) return entry(t, { allowStdio: readHost().allowStdio });
    const { action, values } = command;
    if (!command.flow && action === 'preview') {
      const imported = importCandidates(values['mcp-json'], readHost(), t);
      const flow = newFlow(owner, t);
      flow.candidates = imported.candidates;
      flow.unsupported = imported.unsupported;
      return { ...preview(flow, t), revision: flow.revision };
    }
    if (!command.flow && (action === 'create' || action === 'review-command')) {
      const stdio = action === 'review-command';
      const name = z.string().trim().max(64).safeParse((stdio ? values.commandName : values.id) ?? '');
      const method = authSchema.safeParse(stdio ? 'none' : values.authMethod ?? (values.token ? 'bearer' : 'auto'));
      if (!name.success || !method.success) {
        throw new McpDraftError(400, t('请检查名称和认证方式。', 'Check the name and authentication method.'));
      }
      let candidate: Candidate;
      if (stdio) {
        const host = readHost();
        assertMobileStdioAllowed(host.allowStdio, t);
        candidate = stdioCandidate({ command: values.command, args: values.args?.split(/\r?\n/).filter(line => line.length > 0),
          cwd: values.cwd }, name.data, host, t, {}, environment(keyValueRows(values['mcp-env'], t), t));
      } else {
        const transport = urlTransport.safeParse(values.transport ?? 'http');
        const network = networkSchema.safeParse(values.network ?? 'auto');
        if (!transport.success || !network.success) throw new McpDraftError(400, t('请检查传输协议和网络范围。', 'Check the transport and network scope.'));
        const address = serverAddress(values.url, network.data, t);
        const headers = method.data === 'bearer' && values.token ? bearerHeaders(values.token, t) : undefined;
        candidate = linkCandidate(address, name.data, { type: transport.data, headers });
      }
      const flow = newFlow(owner, t);
      flow.busy = true;
      try {
        return { ...await start(flow, candidate, method.data, t), revision: flow.revision };
      } catch (error) {
        clearTimeout(flow.timer);
        clearDraft(flow);
        flows.delete(flow.id);
        throw error;
      } finally { flow.busy = false; }
    }

    const flow = command.flow ? flows.get(command.flow) : undefined;
    if (!flow || flow.owner !== owner) return entry(t, { message: t('配置已过期，请重新检查。', 'Setup expired. Check the connection again.'), allowStdio: readHost().allowStdio });
    if (flow.busy) throw new McpDraftError(409, t('正在处理，请稍后重试。', 'An operation is in progress. Try again shortly.'));
    if (flow.receipt?.action === action && flow.receipt.revision === command.revision) return flow.receipt.panel;
    if (command.revision !== flow.revision) {
      throw new McpDraftError(409, t('配置步骤已变更，请刷新后重试。', 'The setup step changed. Refresh and try again.'));
    }
    const phase = flow.phase;
    flow.busy = true;
    try {
      const panel = await operate(flow, t, command);
      if (!panel.flow) return panel;
      const revision = flow.revision;
      if (action !== 'status' || phase !== flow.phase) flow.revision += 1;
      const result = { ...panel, revision: flow.revision };
      if (flow.revision !== revision) {
        flow.receipt = action === 'save' || action === 'status' || action === 'callback'
          ? { action, revision, panel: result } : undefined;
      }
      return result;
    } finally {
      flow.busy = false;
    }
  };

  async function operate(flow: Flow, t: Translator, { action, values }: Command): Promise<Panel> {
    const { owner } = flow;
    if (action === 'edit' && flow.phase !== 'saved') {
      clearDraft(flow);
      if (flow.candidates && flow.phase !== 'preview') {
        flow.phase = 'preview';
        flow.candidate = undefined;
        flow.method = undefined;
        flow.rejectedHeaders = undefined;
        renew(flow);
        return preview(flow, t);
      }
      clearTimeout(flow.timer);
      flows.delete(flow.id);
      return entry(t, flow.candidates ? { source: 'json', allowStdio: readHost().allowStdio } : {
        source: flow.candidate?.server.type === 'stdio' ? 'stdio' : 'link', candidate: flow.candidate, method: flow.method, allowStdio: readHost().allowStdio,
      });
    }
    if (action === 'select' && flow.phase === 'preview') {
      const index = z.string().regex(/^\d+$/).safeParse(values.selection);
      const candidate = index.success ? flow.candidates?.[Number(index.data)] : undefined;
      if (!candidate) throw new McpDraftError(400, t('请选择一个服务。', 'Select a server.'));
      flow.selected = candidate;
      return await start(flow, candidate, candidate.server.oauth ? 'oauth' : 'auto', t);
    }
    if (action === 'confirm-check' && flow.phase === 'review' && flow.candidate) {
      if (flow.candidate.server.type === 'stdio') assertMobileStdioAllowed(readHost().allowStdio, t);
      flow.reviewed = true;
      return await connect(flow, t);
    }
    if (action === 'verify' && flow.phase === 'auth' && flow.candidate) {
      const method = authSchema.safeParse(values.method);
      if (!method.success) throw new McpDraftError(400, t('请选择认证方式。', 'Choose an authentication method.'));
      const server = { ...flow.candidate.server };
      if (method.data !== 'oauth' || flow.method !== 'oauth') server.headers = undefined;
      if (method.data === 'bearer') {
        server.headers = bearerHeaders(values.token, t);
      } else if (method.data === 'apiKey') {
        server.headers = headerMap([[values.apiKeyHeader ?? 'X-API-Key', values.apiKey ?? '']], t);
      } else if (method.data === 'headers') {
        const entries = keyValueRows(values.requestHeaders, t);
        server.headers = headerMap(entries.filter(([name, value]) => name.trim() || value.trim()), t);
      }
      if (method.data !== 'oauth') server.oauth = undefined;
      flow.candidate = { ...flow.candidate, server };
      flow.method = method.data;
      flow.rejectedHeaders = false;
      return await testDraft(flow, t);
    }
    if (action === 'change-auth' && flow.phase === 'oauth') return needsAuth(flow, t);
    if (action === 'retry' && flow.phase === 'retry' && flow.draftId) return await probe(flow, t);
    if (action === 'authorize' && flow.phase === 'oauth' && flow.draftId) {
      return authorization(flow, t, drafts.authorize(owner, flow.draftId));
    }
    if ((action === 'status' || action === 'callback') && flow.phase === 'authorizing' && flow.draftId) {
      if (action === 'callback') {
        const url = z.url().max(8192).safeParse(values.callback?.trim());
        if (!url.success) throw new McpDraftError(400, t('请粘贴完整的浏览器地址。', 'Paste the complete browser address.'));
        drafts.redirect(owner, flow.draftId, url.data);
      }
      return authorization(flow, t, drafts.authorization(owner, flow.draftId));
    }
    if (action === 'save' && flow.phase === 'verified' && flow.draftId && flow.candidate) {
      const candidate = flow.candidate;
      const enable = candidate.server.enabled !== false;
      const result = await publish(owner, flow.draftId, enable, candidate.server.type === 'stdio', t);
      const remaining = flow.candidates?.filter(item => item.id !== candidate.id) ?? [];
      const message = result.reloadRequired ? t('连接已保存，重启网关后生效。', 'Connection saved. Restart the Gateway to apply it.')
        : enable ? t('连接已添加', 'Connection added') : t('连接已添加 · 已停用', 'Connection added · Disabled');
      const saved: Panel = { flow: flow.id, ...reviewSummary(candidate, t), message, tone: 'success',
        actions: [{ id: 'done', label: t('完成', 'Done'), dismiss: true }, ...(remaining.length
          ? [{ id: 'add-another', label: t('继续导入其他服务', 'Import another server') }] : [])] };
      flow.phase = 'saved';
      flow.candidate = undefined;
      flow.selected = undefined;
      flow.candidates = remaining.length ? remaining : undefined;
      flow.draftId = undefined;
      renew(flow);
      return saved;
    }
    if (action === 'add-another' && flow.phase === 'saved' && flow.candidates?.length) {
      flow.phase = 'preview';
      return preview(flow, t);
    }
    if (action === 'status' && flow.phase === 'verified') return verified(flow, t, flow.toolCount ?? 0);
    throw new McpDraftError(409, t('此操作已失效，请返回当前配置步骤。', 'This action is no longer available. Return to the current setup step.'));
  }
}

export function assertMobileStdioAllowed(allowed: boolean, t: Translator): void {
  if (!allowed) throw new McpDraftError(409, t(
    '请由 Gateway 管理员运行 xopc config set gateway.mobileMcpAllowStdio true，启用移动端命令启动。',
    'Ask the Gateway administrator to run xopc config set gateway.mobileMcpAllowStdio true to enable mobile command launch.',
  ));
}

function browserAuthorizationUrl(raw: string, server?: McpServerConfig): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return;
    if (server?.xopcPrivateNetwork && typeof server.url === 'string' && new URL(server.url).origin === url.origin) {
      return isPrivateMcpTarget(url) ? url.href : undefined;
    }
    return isPublicMcpTarget(url) ? url.href : undefined;
  } catch { return undefined; }
}
