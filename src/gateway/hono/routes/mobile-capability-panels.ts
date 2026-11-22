import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { AgentCatalogService } from '../../../agent-catalog/service.js';
import type { SkillCatalogEntry } from '../../../agent/agent-manager.js';
import { getMcpConnectionCheck, McpConnectionDrafts, McpDraftError } from '../../../agent/mcp/connection-drafts.js';
import { evictAllEmbeddedSessionRunners } from '../../../agent/embedded/session-runner.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { getStoreConnectorInstallPlan, installStoreConnector } from '../../../capabilities/store-connector.js';
import { buildChannelCatalogForConfig, buildChannelCatalogFromSnapshot, getChannelSetupStatus } from '../../../channels/catalog/channel-catalog-service.js';
import type { ChannelCatalogEntry } from '../../../channels/catalog/channel-catalog-types.js';
import { isBundledChannelExtension } from '../../../channels/bundled-channel-extensions.js';
import type { Config as SurfaceConfig } from '../../../config/config-surface.js';
import type { McpServerConfig } from '../../../config/schema.js';
import { getWorkspacePath } from '../../../config/workspace-path-helpers.js';
import { startConnectorAuthorization } from '../../../connectors/auth-provider-registry.js';
import { getConnectorDefinition } from '../../../connectors/catalog.js';
import { listComposioConnections, revokeComposioConnection } from '../../../connectors/composio.js';
import { assertComposioAccessConfigured } from '../../../connectors/composio-sessions.js';
import { getInstalledConnectorDefinition, listConnectorInstances } from '../../../connectors/instances.js';
import { installConnectorDefinition, updateConnectorConfig } from '../../../connectors/install.js';
import { setConnectorEnabled } from '../../../connectors/lifecycle.js';
import { isManagedConnectorServer, materializeConnectorMcpServer } from '../../../connectors/materialize.js';
import { connectorSecretProviderId } from '../../../connectors/secret-store.js';
import type { ConnectorDefinition, ConnectorInstallInput } from '../../../connectors/types.js';
import { listAgentPluginInventory } from '../../../extensions/agent-plugins/inventory.js';
import { mergeActivationContext } from '../../../extensions/activation-context.js';
import { ActivationPlanner } from '../../../extensions/activation-planner.js';
import { removePluginCredentials } from '../../../extensions/agent-plugins/credentials.js';
import { pluginName } from '../../../extensions/agent-plugins/validation.js';
import { AgentPluginStore } from '../../../extensions/agent-plugins/store.js';
import { pluginAuthorizations } from '../../../extensions/agent-plugins/setup-contract.js';
import { PluginSetupService } from '../../../extensions/agent-plugins/setup.js';
import { withAgentPluginSource } from '../../../extensions/agent-plugins/sources.js';
import { readPluginUserConfig } from '../../../extensions/agent-plugins/user-config.js';
import { findExtension } from '../../../extensions/marketplace.js';
import { getPersonalAgent, personalAgentId } from '../../../personal-agent/repository.js';
import { patchPersonalProfile } from '../../../personal-agent/service.js';
import { listConnectorConnections } from '../../../storage/sqlite/connector-repository.js';
import { connectorPrincipalForSession } from '../../../connectors/principal.js';
import { createLogger } from '../../../utils/logger.js';
import { getGatewayPrincipal, getPersonalOwnerId } from '../../security/gateway-principal.js';
import type { AuthenticatedRouteDeps } from './deps.js';
import { assertMobileStdioAllowed, createMobileMcpSetup } from './mobile-mcp-setup.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';

const path = '/api/capabilities/mobile-actions/panel/:category';
const log = createLogger('MobileCapabilityPanels');
const stableId = z.string().regex(/^[\p{L}\p{M}\p{N}_@./: -]{1,160}$/u)
  .refine(id => !id.split(/[/:.]/).some(part => ['__proto__', 'constructor', 'prototype'].includes(part.toLowerCase())));
const schema = z.strictObject({
  action: z.string().min(1).max(240),
  values: z.record(z.string().max(160), z.string()).refine(values =>
    Object.entries(values).every(([key, value]) => value.length <= (['mcp-json', 'requestHeaders', 'mcp-env'].includes(key) ? 32_768 : 8192))).default({}),
  flow: z.string().max(160).optional(),
  revision: z.number().int().optional(),
});

type Visibility = { field: string; value: string };
export type PanelLink = {
  label: string;
  url: string;
  visibleWhen?: Visibility;
};
export type PanelCopyable = {
  label: string;
  content: string;
  note?: string;
  visibleWhen?: Visibility;
};
export type Field = {
  id: string;
  label: string;
  type: 'text' | 'multiline' | 'secret' | 'toggle' | 'select' | 'list' | 'headers';
  value?: string;
  hint?: string;
  description?: string;
  required?: boolean;
  format?: 'url' | 'json' | 'code';
  addLabel?: string;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  maxItems?: number;
  advanced?: boolean;
  visibleWhen?: Visibility;
  presentation?: 'segmented';
  retain?: boolean;
  options?: { id: string; label: string }[];
};
export type PanelAction = {
  id: string; label: string; confirmation?: string; inlineReview?: boolean; advanced?: boolean;
  visibleWhen?: Visibility; dismiss?: boolean;
};
type SkillResult = { id: string; name: string; summary?: string; source: string; iconUrl?: string; action?: PanelAction };
export type Panel = {
  available?: boolean;
  fields?: Field[];
  actions?: PanelAction[];
  headline?: string;
  subtitle?: string;
  steps?: string[];
  links?: PanelLink[];
  copyable?: PanelCopyable;
  reviewText?: string;
  tone?: 'success';
  advancedLabel?: string;
  detailsLabel?: string;
  message?: string;
  details?: string;
  flow?: string;
  revision?: number;
  authorizationUrl?: string;
  deviceVerificationCode?: string;
  qrUrl?: string;
  expiresAt?: number;
  pollAction?: string;
  results?: SkillResult[];
  chatPrompt?: string;
};
export type Translator = (zh: string, en: string) => string;
export type Command = z.output<typeof schema>;
type SkillMarket = {
  search: (c: Context, query: string) => Promise<{
    items: { id: string; name: string; provider: string; selection?: string; description?: string; iconUrl?: string; installed: boolean }[];
    incomplete: boolean;
  }>;
  install: (c: Context, selection: string) => Promise<{ name: string }>;
};

function useCapability(name: string, id: string, t: Translator): string {
  const label = name.replace(/\s+/g, ' ').trim();
  const target = label && label !== id ? `${label} (${id})` : id;
  return t(`请使用「${target}」帮我：`, `Use “${target}” to help me with:`);
}

function skillChatPrompt(item: SkillCatalogEntry, t: Translator): string | undefined {
  if (!item.enabled || (item.plugin && (!item.plugin.active || item.plugin.readiness !== 'ready'))) return;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.name) ? `/skill:${item.name} `
    : useCapability(item.name, item.directoryId, t);
}

function safeLink(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
}

function safePanelLinks(entries?: ReadonlyArray<{ label: string; url: string; visibleWhen?: Visibility }>): PanelLink[] | undefined {
  const seen = new Set<string>();
  const valid = (entries ?? []).flatMap((item) => {
    const url = safeLink(item.url);
    const label = item.label.trim();
    if (!url || !label || seen.has(url)) return [];
    seen.add(url);
    return [{ label, url, ...(item.visibleWhen ? { visibleWhen: item.visibleWhen } : {}) }];
  });
  return valid.length ? valid : undefined;
}

function text(id: string, label: string, value = '', type: Field['type'] = 'text'): Field {
  return { id, label, value, type };
}

function toggle(id: string, label: string, enabled: boolean): Field {
  return text(id, label, String(enabled), 'toggle');
}

function channelPairPanel(qr: Panel, t: Translator): Panel {
  return { ...qr, pollAction: qr.fields?.length ? undefined : 'pair-status', actions: [
    ...(qr.fields?.length ? [{ id: 'pair-code', label: t('确认配对', 'Confirm pairing') }] : []),
    { id: 'pair-cancel', label: t('取消配对', 'Cancel pairing') },
  ] };
}

type ChannelCredentialSpec = {
  key: string;
  label: string;
  secret: boolean;
  description?: string;
  hint?: string;
};

type MobileChannelDescriptor = {
  pairable: boolean;
  qrMode?: 'login' | 'setup';
  usesManualAction: boolean;
  manualFormAction?: 'setup.manual' | 'setup.start';
  credentials: ChannelCredentialSpec[];
};

const CHANNEL_FALLBACK_CREDENTIALS: Record<string, { setup: 'qr' | 'manual'; credentials: readonly (readonly [key: string, label: string, secret: boolean])[] }> = {
  dingtalk: { setup: 'qr', credentials: [['clientId', 'Client ID', false], ['clientSecret', 'Client Secret', true]] },
  wecom: { setup: 'qr', credentials: [['botId', 'Bot ID', false], ['secret', 'Secret', true]] },
  slack: { setup: 'manual', credentials: [['botToken', 'Bot Token (xoxb-)', true], ['appToken', 'App Token (xapp-)', true]] },
  discord: { setup: 'manual', credentials: [['botToken', 'Bot Token', true]] },
};

const CHANNEL_NON_CREDENTIAL_KEYS = new Set([
  'enabled', 'debug', 'accounts', 'defaults', 'defaultAccount', 'dmPolicy', 'allowFrom',
  'groupPolicy', 'groupAllowFrom', 'credentialIdentity', 'domain', 'connectionMode',
  'requireMention', 'renderMode', 'streaming', 'reactionNotifications', 'inboundDebounceMs',
  'historyLimit', 'textChunkLimit', 'webhookHost', 'webhookPort', 'webhookPath', 'tools',
  'actions', 'blockStreamingCoalesce', 'dynamicAgentCreation', 'replyToMode', 'proxy', 'apiRoot',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractSchemaCredentials(entry: ChannelCatalogEntry): ChannelCredentialSpec[] {
  const schema = isPlainObject(entry.configSchema) ? entry.configSchema : {};
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const elseBlock = isPlainObject(schema.else) ? schema.else : undefined;
  const required = new Set<string>([
    ...(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []),
    ...(Array.isArray(elseBlock?.required) ? elseBlock.required.filter((item): item is string => typeof item === 'string') : []),
  ]);
  const keys = required.size > 0
    ? [...required].filter(key => !CHANNEL_NON_CREDENTIAL_KEYS.has(key) && isPlainObject(properties[key]))
    : Object.entries(properties)
      .filter(([key, prop]) => !CHANNEL_NON_CREDENTIAL_KEYS.has(key) && isPlainObject(prop) && (prop.format === 'password' || entry.uiHints[key]?.sensitive))
      .map(([key]) => key);
  return keys.map((key): ChannelCredentialSpec => {
    const prop = isPlainObject(properties[key]) ? properties[key] : {};
    const hint = entry.uiHints[key];
    const label = hint?.label || (typeof prop.title === 'string' && prop.title.trim()) || key;
    const secret = prop.format === 'password' || hint?.sensitive === true;
    const description = hint?.help || (typeof prop.description === 'string' && prop.description.trim() ? prop.description.trim() : undefined);
    return { key, label, secret, ...(description ? { description } : {}) };
  });
}

function resolveChannelDescriptor(id: string, entry: ChannelCatalogEntry | undefined): MobileChannelDescriptor | undefined {
  const actions = entry?.actions ?? {};
  const hasLoginQr = actions['login.start']?.result === 'qr';
  const hasSetupQr = actions['setup.start']?.result === 'qr';
  const hasSetupManual = actions['setup.manual']?.result === 'form';
  const hasSetupForm = actions['setup.start']?.result === 'form';

  if (id === 'weixin' || hasLoginQr) {
    return { pairable: true, qrMode: 'login', usesManualAction: false, credentials: [] };
  }
  if (id === 'telegram') {
    return { pairable: false, usesManualAction: false, manualFormAction: 'setup.start', credentials: [] };
  }
  if (id === 'feishu') {
    return { pairable: true, qrMode: 'setup', usesManualAction: false, credentials: [] };
  }

  const schemaCredentials = entry ? extractSchemaCredentials(entry) : [];
  const fallback = Object.hasOwn(CHANNEL_FALLBACK_CREDENTIALS, id) ? CHANNEL_FALLBACK_CREDENTIALS[id] : undefined;
  const credentials: ChannelCredentialSpec[] = schemaCredentials.length > 0
    ? schemaCredentials
    : (fallback?.credentials ?? []).map(([key, label, secret]) => ({ key, label, secret }));

  const pairable = hasSetupQr || fallback?.setup === 'qr';
  const usesManualAction = hasSetupManual || Boolean(fallback);
  const manualFormAction = hasSetupManual ? 'setup.manual' : hasSetupForm ? 'setup.start' : fallback ? 'setup.manual' : undefined;
  if (!pairable && !usesManualAction && !manualFormAction) return undefined;
  return {
    pairable,
    ...(pairable ? { qrMode: 'setup' as const } : {}),
    usesManualAction,
    ...(manualFormAction ? { manualFormAction } : {}),
    credentials,
  };
}

function connectorFields(definition: ConnectorDefinition, config: Record<string, unknown> = {}, t?: Translator): Field[] {
  return [
    ...(definition.setup.config ?? []).map((field): Field => {
      const value = config[field.key] ?? field.defaultValue;
      const pathHint = field.type === 'path' && t
        ? t('请填写运行 Gateway 的电脑上的目录路径。', 'Enter a folder path on the computer running the Gateway.')
        : undefined;
      const description = [field.description?.trim(), pathHint].filter(Boolean).join(' ');
      return {
        ...text(field.key, field.label, value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
          field.type === 'boolean' ? 'toggle' : field.type === 'json' ? 'multiline' : 'text'),
        ...(field.placeholder ? { hint: field.placeholder } : {}),
        ...(description ? { description } : {}),
        ...(field.required ? { required: true } : {}),
        ...(field.type === 'json' ? { format: 'json' as const } : {}),
      };
    }),
    ...(definition.setup.secrets ?? []).map((field): Field => ({
      ...text(field.key, field.label, '', 'secret'),
      ...(field.description?.trim() ? { description: field.description.trim() } : {}),
      ...(field.required ? { required: true } : {}),
    })),
  ];
}

function connectorLinks(definition: ConnectorDefinition): PanelLink[] | undefined {
  return safePanelLinks(definition.setup.links?.map(link => ({ label: link.label, url: link.href })));
}

function connectorSetupSteps(definition: ConnectorDefinition, t: Translator): string[] | undefined {
  const { instructions } = definition.setup;
  const guide = instructions && t(instructions['zh-CN'] ?? instructions.en ?? '', instructions.en ?? instructions['zh-CN'] ?? '');
  const steps: string[] = guide ? [guide] : [];
  const hasLinks = Boolean(definition.setup.links?.some(link => safeLink(link.href)));
  const hasPath = Boolean(definition.setup.config?.some(field => field.type === 'path'));
  const hasSecrets = Boolean(definition.setup.secrets?.length);
  if (hasLinks && !guide) {
    steps.push(t('可先打开下方链接获取所需凭据或查看说明。', 'Open the link below to get the required credentials or instructions.'));
  }
  if (hasPath) {
    steps.push(t('目录路径填写运行 Gateway 的电脑上的本地路径。', 'Folder paths refer to directories on the computer running the Gateway.'));
  }
  if (hasSecrets) {
    if (!hasLinks && !guide && definition.auth.mode === 'apiKey') {
      steps.push(t('请在服务商后台创建或复制所需凭据，再回到这里填写。', 'Create or copy the credential in the provider’s console, then return here to enter it.'));
    }
    steps.push(t('填写下方凭据后保存，密钥会加密保存在 Gateway。', 'Enter the credentials below and save. Secrets are stored encrypted on the Gateway.'));
  } else if (definition.setup.config?.length) {
    steps.push(t('填写并保存下方设置。', 'Enter and save the settings below.'));
  }
  return steps.length ? steps : undefined;
}

function connectorSetupGuide(definition: ConnectorDefinition, t: Translator): Pick<Panel, 'links' | 'steps'> {
  return { links: connectorLinks(definition), steps: connectorSetupSteps(definition, t) };
}

function connectorInput(definition: ConnectorDefinition, values: Record<string, string>): ConnectorInstallInput {
  return {
    config: Object.fromEntries((definition.setup.config ?? []).flatMap(field => {
      const value = values[field.key];
      if (value === undefined || value === '') return [];
      return [[field.key, field.type === 'number' ? z.coerce.number().parse(value) : field.type === 'boolean' ? value === 'true'
        : field.type === 'json' ? JSON.parse(value) as unknown : value]];
    })),
    secrets: Object.fromEntries((definition.setup.secrets ?? []).flatMap(field =>
      values[field.key]?.trim() ? [[field.key, values[field.key].trim()]] : [])),
  };
}

export function registerMobileCapabilityPanels(app: Hono, { service, strictRateLimitMiddleware }: AuthenticatedRouteDeps,
  drafts: McpConnectionDrafts, skillMarket: SkillMarket): void {
  const allowStdio = () => service.currentConfig.gateway?.mobileMcpAllowStdio === true;
  const mobileMcpSetup = createMobileMcpSetup(drafts,
    () => ({ allowStdio: allowStdio(), workspace: getWorkspacePath(service.currentConfig) || process.cwd() }),
    (owner, id, enable, stdio, t) => withGatewayConfigWriteLock(service, () => {
      if (stdio) assertMobileStdioAllowed(allowStdio(), t);
      return drafts.commit(owner, id, enable);
    }));
  const store = new AgentPluginStore();
  const setup = new PluginSetupService(store);
  const setupOwner = 'gateway-owner';
  const flows = new Map<string, {
    principal: string; channel: string; accountId?: string; expires: number; qrUrl: string;
    authorizationUrl?: string; deviceVerificationCode?: string;
    message?: string; needsCode?: boolean;
  }>();
  const inspected = new Map<string, { principal: string; packageName: string; hash: string; expires: number; autoEnable: boolean; locale: string; panel: Panel }>();
  const activating = new Set<string>();
  const conversationChecks = new Map<string, { failed: boolean }>();
  const connectorReviews = new Map<string, { principal: string; id: string; expires: number;
    plan: Awaited<ReturnType<typeof getStoreConnectorInstallPlan>> }>();
  const connectorSignIns = new Map<string, {
    principal: string; connectorId: string; url: string; existing: Set<string>;
    providerConnectionId?: string; expires: number; verification?: Promise<unknown>; checkedAt?: number;
  }>();

  async function skill(c: Context, id: string, t: Translator, command?: Command): Promise<Panel> {
    if (id === 'marketplace:search') {
      const installing = command?.action.startsWith('install:');
      const installed = installing ? await skillMarket.install(c, command!.action.slice('install:'.length)) : undefined;
      const query = command?.values.query?.trim() ?? '';
      const panel: Panel = { fields: [{ ...text('query', t('技能名称或关键词', 'Skill name or keyword'), query),
        hint: t('例如：会议纪要、PDF', 'For example: meeting notes or PDF') }],
        actions: [{ id: 'search', label: t('搜索', 'Search') }] };
      if (installed) {
        const entry = service.marketplace.getSkillsApi().catalog.find(row => row.directoryId === installed.name);
        panel.message = t('技能已安装', 'Skill installed');
        if (entry) panel.chatPrompt = skillChatPrompt(entry, t);
      } else if (query) {
        if (query.length < 2) return { ...panel, message: t('请输入至少两个字符。', 'Enter at least two characters.') };
        const found = await skillMarket.search(c, query);
        panel.results = found.items.flatMap(row => row.selection || row.installed ? [{
          id: row.provider + ':' + row.id,
          name: row.name,
          summary: row.description,
          iconUrl: row.iconUrl,
          source: row.provider === 'store' ? t('技能市场', 'Skill store') : row.provider,
          ...(row.selection ? { action: {
            id: 'install:' + row.selection, label: t('安装', 'Install'),
            confirmation: [row.name, row.provider, row.description].filter(Boolean).join('\n'),
          } } : {}),
        }] : []);
        if (found.incomplete) {
          panel.message = panel.results.length
            ? t('部分技能市场暂时不可用，以下是已返回的结果。', 'Some marketplaces are unavailable. These results are available.')
            : t('有技能市场暂时不可用，请稍后重试。', 'Some marketplaces are unavailable. Try again shortly.');
        } else if (!panel.results.length) {
          panel.message = t('没有找到匹配的技能，试试其他关键词。', 'No matching skills. Try a different keyword.');
        }
      }
      return panel;
    }
    const read = () => service.marketplace.getSkillsApi().catalog.find(row => row.directoryId === id);
    let item = read();
    if (!item) throw new McpDraftError(404, 'Skill not found.');
    if (command?.action === 'save') {
      service.marketplace.patchSkillEnabled(id, command.values.enabled === 'true');
      item = read() ?? item;
    }
    return { fields: [toggle('enabled', t('启用技能', 'Enable skill'), item.enabled !== false)],
      message: command?.action === 'save' ? t('已保存', 'Saved') : undefined,
      chatPrompt: skillChatPrompt(item, t),
      actions: [{ id: 'save', label: t('保存', 'Save') }] };
  }

  async function agent(id: string, owner: string, t: Translator, command?: Command): Promise<Panel> {
    const repository = new AgentCatalogRepository();
    let entry = repository.get(id);
    const personal = getPersonalAgent(owner);
    const own = personal?.agentId === id && personal.state === 'ready' ? personal : undefined;
    if (!entry || entry.deletedAt || (!own && (id === personalAgentId(owner) || /^personal-[0-9a-f]{12}$/.test(id)))) {
      throw new McpDraftError(404, 'Agent not found.');
    }
    if (command?.action === 'save') {
      if (entry.revision !== command.revision) throw new McpDraftError(409, 'This profile changed. Reopen the panel.');
      const name = z.string().trim().min(1).max(own ? 40 : 100).parse(command.values.name);
      if (own) {
        if (!await patchPersonalProfile(service, owner, own.revision, name, own.appearance)) {
          throw new McpDraftError(409, 'This profile changed. Reopen the panel.');
        }
      } else {
        const description = z.string().trim().max(2000).parse(command.values.description ?? '');
        await new AgentCatalogService().update(id, { profile: { ...entry.profile, name, description } }, entry.revision);
        service.refreshAgentCatalog();
      }
      entry = repository.get(id)!;
    }
    return { revision: entry.revision, fields: [
      text('name', t('名称', 'Name'), entry.profile?.name ?? id),
      ...(!own ? [text('description', t('职责说明', 'Description'), entry.profile?.description, 'multiline')] : []),
    ], message: command?.action === 'save' ? t('已保存', 'Saved') : undefined,
    actions: [{ id: 'save', label: t('保存', 'Save') }] };
  }

  async function connection(c: Context, id: string, t: Translator, command?: Command): Promise<Panel> {
    async function setupInstalledMcp(serverId: string, name: string, server: McpServerConfig, oauth: boolean,
      guide?: Pick<Panel, 'steps' | 'links'>) {
      if (!command || (!command.flow && command.action !== 'configure-mcp')) return;
      const panel = await mobileMcpSetup(getGatewayPrincipal(c).principalId, t, command, {
        id, serverId, name, server, method: oauth ? 'oauth' : 'auto', guide,
      });
      return command.action === 'edit' && !panel.flow ? await connection(c, id, t) : panel;
    }

    if (id.startsWith('conversation:')) {
      const conversationId = z.uuid().parse(id.slice('conversation:'.length));
      if (!connectorPrincipalForSession(conversationId).isLocalOwner) return { available: false };
      const setup = service.mcpSetup.currentForConversation(conversationId).setup;
      const flow = setup?.setupId ?? (command?.action === 'check' ? command.flow : undefined);
      const ended = { message: t('此连接流程已结束。', 'This connection request has ended.') };
      if (!flow) return command?.flow ? ended : { available: false };
      const checking: Panel = { available: true, flow, pollAction: 'check',
        message: t('正在验证连接…', 'Verifying the connection…') };
      const check = setup ? conversationChecks.get(flow) : undefined;
      if (command) {
        if (command.flow !== flow) throw new McpDraftError(409, 'The connection request changed. Reopen the form.');
        if (command.action !== 'check') {
          const action = z.enum(['advance', 'authorize', 'token', 'cancel', 'approve']).parse(command.action);
          if (check && !check.failed) return checking;
          if (command.revision !== setup?.version) throw new McpDraftError(409, 'The secure form changed. Reopen it before submitting.');
          if (check) conversationChecks.delete(flow);
          const owner = getGatewayPrincipal(c).principalId;
          if (action === 'advance' || action === 'token' || action === 'approve') {
            if (conversationChecks.size >= 128) throw new McpDraftError(429, t('连接验证繁忙，请稍后重试。', 'Connection checks are busy. Try again shortly.'));
            const current = { failed: false };
            conversationChecks.set(flow, current);
            void service.mcpSetup.interact(flow, action, action === 'token' ? command.values : undefined, command.revision, owner)
              .then(() => { conversationChecks.delete(flow); }, () => {
                current.failed = true;
                setTimeout(() => { if (conversationChecks.get(flow) === current) conversationChecks.delete(flow); }, 60_000).unref();
              });
            return checking;
          }
          await service.mcpSetup.interact(flow, action, undefined, command.revision, owner);
        }
      }
      if (check && !check.failed) return checking;
      const result = await service.mcpSetup.interact(flow, 'get').catch(error => {
        if (!setup && error instanceof McpDraftError && error.status === 404) return undefined;
        throw error;
      });
      if (!result) return ended;
      if (result.conversationId !== conversationId) throw new McpDraftError(404, 'Connection request not found.');
      const name = result.displayName ?? result.serverId;
      const failure = check?.failed ? t('未能完成验证，请重试。', 'Could not finish verification. Try again.') : undefined;
      const status = { available: true, flow, revision: result.version, message: failure ? `${name} · ${failure}` : name };
      if (result.expired || result.phase === 'cancelled') return {
        message: result.expired ? t('连接请求已过期。', 'Connection request expired.') : t('连接已取消。', 'Connection cancelled.'),
      };
      if (result.phase === 'ready') return {
        message: result.reloadRequired ? t('连接已保存，重启网关后生效。', 'Connection saved. Restart the Gateway to apply it.')
          : t('连接已完成。', 'Connection complete.'),
        ...(!result.reloadRequired ? { chatPrompt: useCapability(name, result.serverId, t) } : {}),
      };
      if (!setup) return ended;
      const cancel: PanelAction = { id: 'cancel', label: t('取消连接', 'Cancel connection'), advanced: true };
      const plan = result.planApproval;
      const execution = plan?.execution;
      const details = [plan?.endpoint, plan?.purpose, execution &&
        [t('将在网关主机运行', 'Runs on the Gateway host'), JSON.stringify(execution.args), execution.cwd, execution.sourceUrl]
          .filter(Boolean).join('\n'), ...(plan?.sources ?? []).map(source => source.url)]
        .filter(Boolean).join('\n');
      const endpoint = plan?.endpoint ? URL.parse(plan.endpoint)?.host : undefined;
      const reviewSummary = [name, endpoint ?? execution?.command, plan?.purpose?.trim().slice(0, 160),
        execution && t('将在网关运行本地程序。', 'Runs a local program on the Gateway.')].filter(Boolean).join('\n');
      const requiresToken = result.phase === 'token_required' || result.approveWithToken || result.canProvideToken
        || (result.phase === 'blocked' && 'canReplaceToken' in result && result.canReplaceToken);
      if (requiresToken) return {
        ...status, ...(result.approveWithToken ? { details } : {}),
        message: (result.approveWithToken ? reviewSummary + '\n' : name + ' · ') + (failure ?? (result.errorCode === 'credential_rejected'
          ? t('访问密钥未通过验证，请检查后重试。', 'The service rejected the access key. Check it and try again.')
          : t('需要访问密钥', 'Access key required'))),
        fields: (result.secretFields?.length ? result.secretFields : [{ id: 'token', label: 'Token' }])
          .map(field => text(field.id, field.label, '', 'secret')),
        actions: [{ id: 'token', label: t('验证并连接', 'Verify and connect'),
          ...(result.approveWithToken ? { confirmation: [name, details].filter(Boolean).join('\n'), inlineReview: true } : {}) }, cancel],
      };
      if (result.phase === 'approval_required') {
        return { ...status, message: [reviewSummary, failure].filter(Boolean).join('\n'), details, actions: [{ id: 'approve', label: t('确认连接', 'Approve connection'),
          confirmation: [name, details].filter(Boolean).join('\n'), inlineReview: true }, cancel] };
      }
      if (result.phase === 'oauth_required') return { ...status,
        actions: [{ id: 'authorize', label: t('授权并连接', 'Sign in and connect') }, cancel] };
      if (result.phase === 'authorizing') return { ...status,
        authorizationUrl: 'authorizationUrl' in result ? safeLink(result.authorizationUrl) : undefined, pollAction: 'check',
        message: name + ' · ' + t('请在服务商页面完成授权', 'Finish signing in with the provider'), actions: [cancel] };
      return { ...status, actions: [{ id: 'advance', label: t('检查连接', 'Check connection') }, cancel] };
    }
    if (id === 'mcp:setup') {
      return mobileMcpSetup(getGatewayPrincipal(c).principalId, t, command);
    }
    if (id.startsWith('mcp:')) {
      const key = id === 'mcp:server:setup' ? 'setup' : id.slice(4);
      const server = Object.hasOwn(service.currentConfig.mcp?.servers ?? {}, key) ? service.currentConfig.mcp?.servers?.[key] : undefined;
      if (!server || isManagedConnectorServer(server)) throw new McpDraftError(404, 'Connection not found.');
      if (server.url && server.enabled !== false) {
        const setup = await setupInstalledMcp(key, server.displayName ?? key, server, Boolean(server.oauth));
        if (setup) return setup;
      }
      if (command?.flow) throw new McpDraftError(409, 'The connection setup is unavailable. Reopen the connection.');
      if (command?.action === 'save') {
        await withGatewayConfigWriteLock(service, async () => {
          const before = service.currentConfig;
          const next = structuredClone(before);
          const selected = next.mcp?.servers?.[key];
          if (!selected) throw new McpDraftError(404, 'Connection not found.');
          selected.enabled = command.values.enabled === 'true';
          if (!(await service.saveConfig(next, before)).saved) throw new McpDraftError(409, 'Connection settings changed.');
        });
        return connection(c, id, t);
      }
      if (command?.action === 'remove') {
        await withGatewayConfigWriteLock(service, async () => {
          const before = service.currentConfig;
          const next = structuredClone(before);
          if (!next.mcp?.servers || !Object.hasOwn(next.mcp.servers, key)) throw new McpDraftError(404, 'Connection not found.');
          delete next.mcp.servers[key];
          if (!(await service.saveConfig(next, before)).saved) throw new McpDraftError(409, 'Connection settings changed.');
        });
        return {
          message: t('连接已移除。', 'Connection removed.'),
          actions: [{ id: 'done', label: t('完成', 'Done'), dismiss: true }],
        };
      }
      const transportLabel = server.type === 'stdio'
        ? t('命令启动 · 在 Gateway 主机运行', 'Command · Runs on the Gateway host')
        : server.type === 'sse'
          ? t('远程 MCP · 旧版 SSE', 'Remote MCP · Legacy SSE')
          : t('远程 MCP · Streamable HTTP', 'Remote MCP · Streamable HTTP');
      const subtitle = [transportLabel, server.description?.trim()].filter(Boolean).join(' · ');
      const ready = server.enabled !== false && (!server.url || Boolean(getMcpConnectionCheck(server)));
      return {
        subtitle,
        message: ready ? t('已启用，可在对话中直接使用此 MCP 服务。', 'Enabled and ready to use in chat.')
          : server.enabled === false ? t('连接已停用。', 'The connection is disabled.')
          : t('请先验证连接。', 'Verify this connection before using it.'),
        detailsLabel: t('关于此连接', 'About this connection'),
        details: t('服务地址与认证凭据保存在 Gateway。如需修改连接地址或凭据，可移除后重新添加。',
          'Server address and credentials are stored on the Gateway. To change them, remove this connection and add it again.'),
        fields: [toggle('enabled', t('启用连接', 'Enable connection'), server.enabled !== false)],
        chatPrompt: ready ? useCapability(server.displayName ?? key, key, t) : undefined,
        actions: [
          ...(server.url && server.enabled !== false ? [{
            id: 'configure-mcp',
            label: server.oauth ? ready ? t('重新授权', 'Reauthorize') : t('连接账号', 'Connect account')
              : t('验证连接', 'Verify connection'),
            advanced: ready,
          }] : []),
          { id: 'save', label: t('保存配置', 'Save settings') },
          {
            id: 'remove',
            label: t('移除连接', 'Remove connection'),
            confirmation: t('移除后，助理将无法再使用此 MCP 服务。', 'The assistant will no longer be able to use this MCP server.'),
            advanced: true,
          },
        ],
      };
    }
    const definition = getConnectorDefinition(id);
    if (definition?.auth.mode !== 'oauth' || definition.auth.provider !== 'composio') {
      const instance = listConnectorInstances(service.currentConfig).find(row => row.connectorId === id);
      const known = instance ? getInstalledConnectorDefinition(service.currentConfig, instance.instanceId) ?? definition : definition;
      if (known) {
        let guide = connectorSetupGuide(known, t);
        const guideSource = instance && known.source === 'store' && !known.setup.links?.length && !known.setup.instructions
          ? known.provenance : undefined;
        if (guideSource && command?.action === 'setup-guide') {
          const { packageName, sha256 } = guideSource;
          const published = await getStoreConnectorInstallPlan(service.currentConfig, packageName, known.version).catch(() => undefined);
          if (published?.definition.provenance?.sha256 !== sha256) {
            throw new McpDraftError(409, t('暂时无法读取此版本的官方配置说明。', 'The setup guide for this installed version is unavailable.'));
          }
          guide = connectorSetupGuide(published.definition, t);
        }
        const server = instance?.materialized.type === 'mcp' ? service.currentConfig.mcp?.servers?.[instance.instanceId] : undefined;
        const remote = server?.url ? server : undefined;
        const oauth = known.auth.mode === 'oauth' || Boolean(remote?.oauth);
        if (instance?.enabled && remote) {
          const setup = await setupInstalledMcp(instance.instanceId, instance.displayName, remote, oauth, guide);
          if (setup) return setup;
        }
        if (command?.flow) throw new McpDraftError(409, 'The connection setup is unavailable. Reopen the connection.');
        if (command?.action === 'save') {
          await withGatewayConfigWriteLock(service, async () => {
            const previous = service.currentConfig;
            const next = structuredClone(previous);
            const input = connectorInput(known, command.values);
            if (instance) {
              const configChanged = !isDeepStrictEqual(input.config ?? {}, instance.config ?? {});
              const secretsChanged = Object.keys(input.secrets ?? {}).length > 0;
              if (configChanged || secretsChanged) {
                if (known.runtime.type === 'mcp' && known.setup.secrets?.length) {
                  const resolver = new CredentialResolver();
                  const secrets = { ...input.secrets };
                  for (const field of known.setup.secrets) {
                    if (field.required && !secrets[field.key]) {
                      secrets[field.key] = await resolver.resolveApiKey(connectorSecretProviderId(known.id, field.key));
                    }
                  }
                  const replacement = { ...input, secrets };
                  if (materializeConnectorMcpServer(known, replacement).serverId !== instance.instanceId) {
                    throw new McpDraftError(400, t('连接名称不能在这里更改。', 'This connection name cannot be changed here.'));
                  }
                  await installConnectorDefinition(next, known, replacement, resolver);
                } else {
                  updateConnectorConfig(next, instance.instanceId, input);
                }
              }
              setConnectorEnabled(next, instance.instanceId, command.values.enabled === undefined ? instance.enabled : command.values.enabled === 'true');
            } else {
              await installConnectorDefinition(next, known, input);
            }
            if (!(await service.saveConfig(next, previous)).saved) throw new McpDraftError(409, 'Connection settings changed.');
          });
          return { ...await connection(c, id, t), message: t('连接设置已保存。', 'Connection settings saved.') };
        }
        const ready = instance?.enabled && (remote ? instance.connectionStatus === 'connected'
          : !['unauthorized', 'error'].includes(instance.connectionStatus) && !['missing', 'unauthorized'].includes(instance.authStatus));
        return {
          ...guide,
          ...(instance?.enabled && remote && !ready ? { message: oauth
            ? t('此连接需要完成 OAuth 授权和验证。', 'Complete OAuth authorization and verification to use this connection.')
            : t('请先验证连接。', 'Verify this connection before using it.') } : {}),
          fields: [...connectorFields(known, instance?.config, t), ...(instance
            ? [toggle('enabled', t('启用连接', 'Enable connection'), instance.enabled)] : [])],
          chatPrompt: ready ? useCapability(instance.displayName, id, t) : undefined,
          actions: [...(instance?.enabled && remote ? [{
            id: 'configure-mcp', label: oauth
              ? ready ? t('重新授权', 'Reauthorize') : t('连接账号', 'Connect account')
              : t('验证连接', 'Verify connection'),
            advanced: Boolean(ready),
          }] : []), ...(guideSource && command?.action !== 'setup-guide' && (known.auth.mode === 'apiKey' || oauth) ? [{
            id: 'setup-guide', label: t('查看服务商配置说明', 'View provider setup guide'), advanced: true,
          }] : []), { id: 'save', label: instance ? t('保存设置', 'Save settings') : t('添加连接', 'Add connection'),
            ...(!instance ? { confirmation: [known.displayName, ...(known.capabilities ?? [])].join('\n') } : {}) }],
        };
      }
      const principal = getGatewayPrincipal(c).principalId;
      if (command?.action === 'inspect') {
        const plan = await getStoreConnectorInstallPlan(service.currentConfig, id).catch(() => {
          throw new McpDraftError(404, t('未能读取市场连接。请稍后重试。', 'Could not read this marketplace connection. Try again.'));
        });
        for (const [key, review] of connectorReviews) if (review.expires <= Date.now()) connectorReviews.delete(key);
        if (connectorReviews.size >= 128) connectorReviews.delete(connectorReviews.keys().next().value!);
        const flow = randomUUID();
        connectorReviews.set(flow, { principal, id, plan, expires: Date.now() + 600_000 });
        return {
          flow,
          ...(plan.definition.runtime.type === 'mcp' && plan.definition.auth.mode === 'oauth' ? {
            message: t('安装后需要在服务商页面授权。', 'After installation, authorize with the provider.'),
          } : {}),
          ...connectorSetupGuide(plan.definition, t),
          fields: connectorFields(plan.definition, {}, t),
          actions: [{ id: 'install',
            label: t('安装连接', 'Install connection'),
            confirmation: [plan.packageName, plan.version, ...plan.definition.capabilities].join('\n') }],
        };
      }
      if (command?.action === 'install') {
        const flow = command.flow ?? '';
        const review = connectorReviews.get(flow);
        if (!review || review.principal !== principal || review.id !== id || review.expires <= Date.now()) {
          throw new McpDraftError(409, t('请重新查看安装信息。', 'Review the installation again.'));
        }
        connectorReviews.delete(flow);
        try {
          await withGatewayConfigWriteLock(service, async () => {
            const previous = service.currentConfig;
            const next = structuredClone(previous);
            await installStoreConnector(next, id, connectorInput(review.plan.definition, command.values),
              review.plan.version, review.plan.reviewHash);
            if (!(await service.saveConfig(next, previous)).saved) throw new McpDraftError(409, 'Connection settings changed.');
          });
          const installed = await connection(c, id, t);
          return { ...installed, message: [t('连接已安装。', 'Connection installed.'), installed.message].filter(Boolean).join(' ') };
        } catch (error) {
          connectorReviews.set(flow, review);
          throw error;
        }
      }
      return {
        steps: [
          t('点击下方「设置连接」拉取此连接所需的配置项与权限说明。', 'Tap Set up connection to inspect required settings and permissions.'),
          t('填写必要参数并确认安装后即可在对话中使用。', 'Fill in any required parameters and confirm installation to use it in chat.'),
        ],
        actions: [{ id: 'inspect', label: t('设置连接', 'Set up connection') }],
      };
    }
    const currentAccounts = () => listConnectorConnections({ principalId: 'local-owner', connectorId: id }).filter(row => row.status === 'active');
    const instanceFor = (config: typeof service.currentConfig) => listConnectorInstances(config).find(row => row.connectorId === id);
    const ensureEnabled = () => withGatewayConfigWriteLock(service, async () => {
      const previous = service.currentConfig;
      const instance = instanceFor(previous);
      if (instance?.enabled) return;
      const next = structuredClone(previous);
      if (instance) setConnectorEnabled(next, instance.instanceId, true);
      else await installConnectorDefinition(next, definition, {});
      if (!(await service.saveConfig(next, previous)).saved) throw new McpDraftError(409, 'Connection settings changed.');
    });
    const rows = currentAccounts();
    const principal = getGatewayPrincipal(c).principalId;
    const waiting = (flow: string, url: string): Panel => ({
      flow, authorizationUrl: url, pollAction: 'check',
      message: t('在服务商页面完成授权。返回后会自动刷新。', 'Finish signing in with the provider. This panel updates automatically.'),
      actions: [{ id: 'cancel-sign-in', label: t('取消连接', 'Cancel sign-in') }],
    });
    if (command?.action === 'authorize' || command?.action === 'enable') {
      await assertComposioAccessConfigured().catch(() => {
        throw new McpDraftError(400, t('请先在电脑端的连接服务设置中配置 Composio 或登录 XOPC Cloud，再回到手机连接此账号。',
          'Set up Composio or sign in to XOPC Cloud in Connection service settings on your computer, then try again here.'));
      });
      await ensureEnabled();
      if (command.action === 'enable') return connection(c, id, t);
      const auth = await startConnectorAuthorization(definition, service.currentConfig).catch(() => {
        throw new McpDraftError(400, t('无法启动授权。请检查电脑端的连接服务和此应用的授权配置，然后重试。',
          'Could not start sign-in. Check the connection service and this app’s authorization settings on your computer, then try again.'));
      });
      const authorizationUrl = safeLink(auth.authorizationUrl);
      if (!authorizationUrl) throw new McpDraftError(500, t('未收到可用的授权链接。', 'No valid authorization link was returned.'));
      const flow = randomUUID();
      for (const [key, value] of connectorSignIns) if (value.expires <= Date.now()) connectorSignIns.delete(key);
      if (connectorSignIns.size >= 128) connectorSignIns.delete(connectorSignIns.keys().next().value!);
      connectorSignIns.set(flow, { principal, connectorId: id, url: authorizationUrl,
        providerConnectionId: auth.connectionId, existing: new Set(rows.map(row => row.id)), expires: Date.now() + 300_000 });
      return waiting(flow, authorizationUrl);
    }
    if (command?.action === 'check' || command?.action === 'cancel-sign-in') {
      const flow = command.flow ?? '';
      const signIn = connectorSignIns.get(flow);
      if (!signIn || signIn.principal !== principal || signIn.connectorId !== id || signIn.expires <= Date.now()) {
        return { ...await connection(c, id, t), message: t('授权已过期，请重新连接。', 'Sign-in expired. Connect again.') };
      }
      if (command.action === 'cancel-sign-in') {
        connectorSignIns.delete(flow);
        return connection(c, id, t);
      }
      if (!signIn.verification && Date.now() - (signIn.checkedAt ?? 0) >= 3500) {
        signIn.verification = listComposioConnections().catch(() => undefined).finally(() => {
          signIn.verification = undefined;
          signIn.checkedAt = Date.now();
        });
      }
      await signIn.verification;
      if (!currentAccounts().some(row => signIn.providerConnectionId
        ? row.providerConnectionId === signIn.providerConnectionId
        : !signIn.existing.has(row.id))) return waiting(flow, signIn.url);
      connectorSignIns.delete(flow);
      return connection(c, id, t);
    }
    if (command?.action.startsWith('disconnect:')) {
      const row = rows.find(candidate => candidate.id === command.action.slice('disconnect:'.length));
      if (!row || definition.auth.mode !== 'oauth' || definition.auth.provider !== 'composio') throw new McpDraftError(404, 'Connection not found.');
      await revokeComposioConnection(row.id);
      return connection(c, id, t);
    }
    if (rows.length && !instanceFor(service.currentConfig)?.enabled) {
      return { message: t('账号已授权，连接待启用。', 'Account authorized. Enable the connection to use it.'),
        actions: [{ id: 'enable', label: t('启用连接', 'Enable connection') }] };
    }
    if (rows.length) {
      return {
        message: t('已连接', 'Connected'),
        chatPrompt: useCapability(definition.displayName, id, t),
        actions: rows.map((row, index) => ({
          id: 'disconnect:' + row.id,
          label: rows.length > 1 ? t('断开账号 ', 'Disconnect account ') + (index + 1) : t('断开连接', 'Disconnect'),
          confirmation: t('断开后，助理将无法使用此账号。', 'The assistant will lose access to this account.'),
          advanced: true,
        })),
      };
    }
    const composioReady = await assertComposioAccessConfigured().then(() => true, () => false);
    if (!composioReady) {
      return {
        message: t('需先在电脑端配置连接服务。', 'Set up the connection service on your computer first.'),
        steps: [
          t('在电脑端打开「设置 → 连接服务」，配置 Composio 或登录 XOPC Cloud。', 'Open Settings → Connection service on your computer and configure Composio or sign in to XOPC Cloud.'),
          t('完成后回到此处点击「连接账号」即可完成授权。', 'Return here and tap Connect account to authorize.'),
        ],
        actions: [{ id: 'authorize', label: t('连接账号', 'Connect account'), advanced: true }],
      };
    }
    return {
      message: t('尚未连接', 'Not connected'),
      steps: [
        t('点击下方「连接账号」，在浏览器登录服务商账号并授权。', 'Tap Connect account to sign in and authorize in your browser.'),
        t('授权完成后返回本应用，状态会自动更新。', 'Return to this app after signing in; the status updates automatically.'),
      ],
      actions: [{ id: 'authorize', label: t('连接账号', 'Connect account') }],
    };
  }

  async function plugin(c: Context, id: string, t: Translator, command?: Command): Promise<Panel> {
    id = listAgentPluginInventory().find(row => row.provenance?.packageName === id)?.pluginId ?? id;
    const pkg = pluginName.safeParse(id).success ? store.pending(id) ?? store.get(id) : undefined;
    if (!pkg) {
      const registry = await findExtension(id);
      if (registry?.packageType !== 'plugin') {
        const loader = service.getExtensionLoader();
        if (!loader || isBundledChannelExtension(id) || !loader.discoverExtensions().some(row => row.id === id)) {
          return { message: t('未找到可配置的插件。', 'No configurable plugin was found.') };
        }
        if (command?.action === 'save') {
          const result = await service.setExtensionActivationTarget(id, command.values.enabled === 'true');
          if (!result.ok) throw new McpDraftError(400, result.error ?? 'Could not save extension settings.');
          const panel = await plugin(c, id, t);
          return { ...panel, chatPrompt: result.requiresGatewayRestart ? undefined : panel.chatPrompt, message: result.requiresGatewayRestart
            ? t('已保存，重启网关后生效。', 'Settings saved. Restart the Gateway to apply them.')
            : t('已保存。', 'Settings saved.') };
        }
        const active = new ActivationPlanner(loader.buildManifestRegistry())
          .getActivatedIds(mergeActivationContext(service.currentConfig as unknown as SurfaceConfig)).includes(id);
        const runtime = loader.getRegistry().getExtension(id);
        return { fields: [toggle('enabled', t('启用插件', 'Enable plugin'), active)],
          chatPrompt: active && runtime?.enabled ? useCapability(runtime.name, id, t) : undefined,
          actions: [{ id: 'save', label: t('保存设置', 'Save settings') }] };
      }
      const principal = getGatewayPrincipal(c).principalId;
      const source = 'store:' + registry.id;
      if (command?.action === 'install') {
        const review = command.flow && inspected.get(command.flow);
        if (!review || review.expires <= Date.now() || review.principal !== principal || review.packageName !== registry.id) {
          throw new McpDraftError(409, 'Review the package again before installing.');
        }
        inspected.delete(command.flow!);
        const installed = await withAgentPluginSource(source, service.currentConfig, (local, provenance, commit, manifest) =>
          store.install(local, { reviewHash: review.hash, sourceLabel: source, provenance, resolvedCommit: commit, importManifest: manifest }))
          .catch(error => { inspected.set(command.flow!, review); throw error; });
        service.marketplace.reloadSkills();
        if (!review.autoEnable) return plugin(c, installed.id, t, { action: 'start', values: {} });
        const config = service.currentConfig;
        const workspace = getWorkspacePath(config) || process.cwd();
        const job = setup.create(installed.id, setupOwner);
        activating.add(installed.id);
        void setup.act(installed.id, setupOwner, { action: 'prepare', expectedRevision: job.revision }, config, workspace)
          .then(async prepared => {
            if (prepared.packageRevision !== installed.receipt.revision || prepared.state !== 'action_required' || prepared.resources !== 'ready'
              || prepared.partial || prepared.missingConfig.length || prepared.authorizations.length
              || prepared.connections.some(row => row.state !== 'connected')) return;
            await setup.act(installed.id, setupOwner, { action: 'complete', expectedRevision: prepared.revision, allowPartial: false }, config, workspace);
            evictAllEmbeddedSessionRunners();
            service.marketplace.reloadSkills();
          }).catch(() => { log.warn({ pluginId: installed.id }, 'Could not finish activating the reviewed plugin'); })
          .finally(() => { activating.delete(installed.id); });
        return { pollAction: 'refresh', message: t('正在安装并启用…', 'Installing and enabling…') };
      }
      for (const [key, value] of inspected) if (value.expires <= Date.now()) inspected.delete(key);
      const locale = c.req.query('locale') ?? '';
      const cached = [...inspected.values()].find(value => value.principal === principal && value.packageName === registry.id && value.locale === locale);
      if (cached && !command) return cached.panel;
      try {
        const review = await withAgentPluginSource(source, service.currentConfig, (local, _provenance, _commit, manifest) =>
          store.inspect(local, source, manifest));
        const servers = Object.entries(review.servers);
        const accountRequired = pluginAuthorizations(review.manifest).length > 0 || servers.some(([, server]) => server.type !== 'stdio');
        const autoEnable = !accountRequired && !review.diagnostics.length &&
          !Object.values(review.layout?.userConfig ?? {}).some(field => field.required && (field.default == null || field.default === ''));
        const flow = randomUUID();
        const resources = review.resources ?? [];
        const message = [registry.author ? t('发布者　', 'Publisher: ') + registry.author : t('来源　xopc 插件市场', 'Source: xopc Plugin Store'),
          review.skills.length ? t('向助理提供技能', 'Adds skills to the assistant') : undefined,
          resources.length ? t('下载所需文件', 'Downloads required files') : undefined,
          servers.some(([, server]) => server.type === 'stdio') || resources.some(resource => resource.executable)
            ? t('在网关运行本地工具', 'Runs local tools on the Gateway') : undefined,
          accountRequired ? t('安装后需完成连接设置', 'Connection setup follows installation') : undefined].filter(Boolean).join('\n');
        const details = [t('来源　xopc 插件市场', 'Source: xopc Plugin Store'), registry.version && t('版本 ', 'Version ') + registry.version,
          t('插件 ', 'Plugin ') + registry.id,
          ...review.skills.map(item => t('技能 ', 'Skill ') + item.name),
          ...resources.map(item => t('下载 ', 'Download ') + item.id + ' · ' + (URL.parse(item.url)?.host ?? '')),
          ...servers.map(([name, server]) => t('工具 ', 'Tool ') + name + (server.type === 'stdio'
            ? ' · ' + t('本地执行', 'Runs locally') : ' · ' + (URL.parse(server.url)?.host ?? ''))),
          ...pluginAuthorizations(review.manifest).map(account => t('账号授权 ', 'Account access ') + account.title),
          ...review.diagnostics.map(item => item.message)].filter(Boolean).join('\n');
        const panel = { flow, message, details,
          actions: [{ id: 'install', label: autoEnable ? t('安装并启用', 'Install and enable') : t('安装插件', 'Install plugin'),
            confirmation: message + '\n' + details, inlineReview: true }] };
        if (inspected.size >= 128) inspected.delete(inspected.keys().next().value!);
        inspected.set(flow, { principal, packageName: registry.id, hash: review.reviewHash, expires: Date.now() + 600_000, autoEnable, locale, panel });
        return panel;
      } catch {
        return { message: t('暂时无法读取安装信息。', 'Installation information is unavailable.'),
          actions: [{ id: 'inspect', label: t('重试', 'Retry') }] };
      }
    }
    if (activating.has(id)) return { pollAction: 'refresh', message: t('正在安装并启用…', 'Installing and enabling…') };
    let job = setup.get(id, setupOwner);
    const config = service.currentConfig;
    const roots = getWorkspacePath(config) || process.cwd();
    const declarations = pluginAuthorizations(pkg.manifest);
    const methods = declarations.flatMap(account => account.methods.map(method =>
      ({ account, method, key: Buffer.from(JSON.stringify([account.id, method.id])).toString('base64url') })));
    const accountFields = new Set(methods.flatMap(({ method }) => method.type === 'form' ? method.fields : []));
    const serverKey = (name: string) => Buffer.from(name).toString('base64url');
    const directServers = Object.keys(pkg.servers).filter(name => !declarations.some(account => account.servers.includes(name)));
    let authorizationUrl: string | undefined;
    let authorizationQrUrl: string | undefined;
    let signInExpiresAt: number | undefined;
    let signInState: string | undefined;
    let signInAction: string | undefined;
    let redirectAction: string | undefined;
    let signInInstruction: string | undefined;
    if (command) {
      if (command.action === 'start') {
        job = setup.create(id, setupOwner);
        if (job.resources !== 'ready' && job.state !== 'running') setup.startPrepare(id, setupOwner, job.revision, config, roots);
      }
      else if (command.action === 'disable') {
        store.setEnabled(id, false);
        evictAllEmbeddedSessionRunners(); service.marketplace.reloadSkills();
      } else if (command.action === 'revoke' && store.get(id)) {
        if (job && command.revision !== job.revision) throw new McpDraftError(409, 'Setup changed. Refresh the panel and retry.');
        store.setEnabled(id, false);
        if (job && job.state !== 'cancelled') await setup.act(id, setupOwner,
          { action: 'cancel', expectedRevision: job.revision }, config, roots);
        await removePluginCredentials(store, id);
        evictAllEmbeddedSessionRunners();
        service.marketplace.reloadSkills();
      } else if (job) {
        const [action, target] = command.action.split(':');
        if (!['refresh', 'status', 'callback', 'status-server', 'callback-server'].includes(action) && command.revision !== job.revision) {
          throw new McpDraftError(409, 'Setup changed. Refresh the panel and retry.');
        }
        if (action === 'prepare' || action === 'verify') setup.startPrepare(id, setupOwner, job.revision, config, roots);
        if (action === 'complete') {
          if (job.state === 'completed' && !job.partial && !store.pending(id)) store.setEnabled(id, true);
          else await setup.act(id, setupOwner, { action, expectedRevision: job.revision, allowPartial: false }, config, roots);
          evictAllEmbeddedSessionRunners(); service.marketplace.reloadSkills();
        }
        const chosen = methods.find(item => item.key === target);
        if (chosen && action === 'authorize' && chosen.method.type !== 'form') {
          await setup.act(id, setupOwner, { action, expectedRevision: job.revision, server: chosen.account.id, method: chosen.method.id }, config, roots);
        }
        if (chosen && action === 'credentials' && chosen.method.type === 'form') {
          const values = Object.fromEntries(chosen.method.fields.filter(field => command.values[field])
            .map(field => [field, command.values[field]]));
          const updated = await setup.act(id, setupOwner, { action: 'configure', expectedRevision: job.revision, values,
            authorization: chosen.account.id, method: chosen.method.id }, config, roots);
          setup.startPrepare(id, setupOwner, updated.revision, config, roots);
        }
        const standalone = directServers.find(name => serverKey(name) === target);
        const authTarget = chosen?.account.id ?? standalone;
        if (standalone && action === 'authorize-server') {
          await setup.act(id, setupOwner, { action: 'authorize', expectedRevision: job.revision, server: standalone }, config, roots);
        }
        if (authTarget && (action === 'callback' || action === 'callback-server')) {
          if (!setup.redirect(id, setupOwner, authTarget, z.url().parse(command.values.callback), config)) {
            throw new McpDraftError(400, t('此回调与当前授权不匹配。', 'This callback does not match the current authorization.'));
          }
        }
        if (authTarget && ['authorize', 'status', 'callback', 'authorize-server', 'status-server', 'callback-server'].includes(action)) {
          const auth = await setup.authorization(id, setupOwner, authTarget, config);
          signInState = auth?.state;
          if (auth && 'challenge' in auth) {
            const challengeUrl = safeLink(auth.challenge?.url);
            if (auth.challenge?.type === 'qr') authorizationQrUrl = challengeUrl;
            if (auth.challenge?.type === 'url') authorizationUrl = challengeUrl;
            signInExpiresAt = auth.expiresAt;
            signInInstruction = auth.challenge?.message;
          } else if (auth && 'authorizationUrl' in auth) {
            authorizationUrl = safeLink(auth.authorizationUrl);
          }
          signInAction = (chosen ? 'status:' : 'status-server:') + target;
          if (auth && 'acceptsRedirect' in auth && auth.acceptsRedirect) redirectAction = (chosen ? 'callback:' : 'callback-server:') + target;
          if (auth?.state === 'connected') {
            const latest = setup.get(id, setupOwner);
            if (latest && latest.state !== 'running') setup.startPrepare(id, setupOwner, latest.revision, config, roots);
          }
        }
        if (action === 'configure') {
          const values = Object.fromEntries(Object.entries(pkg.layout?.userConfig ?? {}).flatMap(([key, spec]) => {
            const value = command.values[key];
            if (accountFields.has(key) || value === undefined || value === '') return [];
            return [[key, spec.type === 'boolean' ? value === 'true' : spec.type === 'number' ? z.coerce.number().parse(value) : value]];
          }));
          const updated = await setup.act(id, setupOwner, { action, expectedRevision: job.revision, values }, config, roots);
          setup.startPrepare(id, setupOwner, updated.revision, config, roots);
        }
      }
      job = setup.get(id, setupOwner);
    }
    const active = store.get(id)?.receipt.enabled === true;
    if (pkg.readiness === 'blocked') {
      return { message: t('此插件暂不可用。请返回列表刷新后重试。', 'This plugin is unavailable. Refresh the list and try again.') };
    }
    if (signInState && ['starting', 'authorizing', 'awaiting_user', 'preparing'].includes(signInState)) {
      return { authorizationUrl, qrUrl: authorizationQrUrl, expiresAt: signInExpiresAt, revision: job?.revision, pollAction: signInAction,
        message: signInInstruction ?? (authorizationQrUrl
          ? t('请用对应应用扫描二维码。', 'Scan this QR code with the service’s app.')
          : t('请在服务商页面完成授权，返回后会自动更新。', 'Finish signing in with the provider. This panel updates automatically.')),
        ...(redirectAction ? { fields: [{ ...text('callback', t('浏览器最后打开的地址', 'Address shown in your browser')), advanced: true }],
          actions: [{ id: redirectAction, label: t('完成授权', 'Finish authorization'), advanced: true }] } : {}) };
    }
    const result: Panel = { revision: job?.revision, actions: [],
      chatPrompt: active && pkg.readiness === 'ready' && !store.pending(id) ? useCapability(pkg.manifest.name, id, t) : undefined,
      message: active ? t('已启用', 'Enabled') : t('未启用', 'Disabled') };
    const actions = result.actions!;
    if (active) actions.push({ id: 'disable', label: t('停用插件', 'Disable plugin'), advanced: true });
    if (store.get(id) && (methods.length || job?.connections.length)) {
      actions.push({ id: 'revoke', label: t('撤销授权并清除凭据', 'Revoke authorization and clear credentials'),
        confirmation: t('插件会停用，专属凭据和配置将被清除。', 'The plugin will be disabled and its credentials and settings cleared.'), advanced: true });
    }
    if (!job || job.state === 'cancelled') {
      if (!active) {
        const nonAccountConfigCount = Object.keys(pkg.layout?.userConfig ?? {}).filter(key => !accountFields.has(key)).length;
        const needsAccountSetup = declarations.length > 0 || directServers.some(name => pkg.servers[name]?.type !== 'stdio');
        const previewSteps: string[] = [];
        if (nonAccountConfigCount === 0 && !needsAccountSetup) {
          previewSteps.push(t('此插件无需额外凭据，点击下方「启用插件」即可开始使用。', 'No extra credentials required. Tap Enable plugin to start using it.'));
        } else {
          previewSteps.push(t('点击下方「启用插件」初始化插件环境。', 'Tap Enable plugin to initialize the plugin environment.'));
          if (nonAccountConfigCount > 0) {
            previewSteps.push(t('按提示填写必要的配置项。', 'Fill in the required configuration fields.'));
          }
          if (needsAccountSetup) {
            previewSteps.push(t('完成服务账号授权后即可在对话中使用。', 'Complete account authorization to use this plugin in chat.'));
          }
        }
        result.steps = previewSteps;
      }
      actions.push({ id: 'start', label: active ? t('设置授权', 'Set up access') : t('启用插件', 'Enable plugin'), advanced: active });
      return result;
    }
    if (job.state === 'running' || job.resources === 'running') {
      return { revision: job.revision, pollAction: 'refresh', message: t('正在完成设置…', 'Finishing setup…') };
    }
    if (job.resources !== 'ready') {
      actions.push({ id: 'prepare', label: t('重试设置', 'Try setup again') });
      result.message = job.error ? t('暂时无法完成设置，请重试。', 'Could not finish setup. Try again.') : result.message;
      return result;
    }
    const saved = readPluginUserConfig(store, id, pkg.receipt.revision);
    const missingConfig = new Set(job.missingConfig);
    result.fields = Object.entries(pkg.layout?.userConfig ?? {}).filter(([key]) => !accountFields.has(key)).map(([key, field]) => {
      const value = saved[key] ?? field.default;
      return {
        ...(field.sensitive ? { ...text(key, field.title ?? key, '', 'secret'),
          hint: saved[key] ? t('留空保留现有凭据', 'Leave blank to keep the saved credential') : undefined }
          : text(key, field.title ?? key, String(value ?? (field.type === 'boolean' ? false : '')), field.type === 'boolean' ? 'toggle' : 'text')),
        ...(field.description ? { description: field.description } : {}),
        ...(field.required ? { required: true } : {}),
        advanced: !missingConfig.size,
      };
    });
    if (result.fields.length) actions.push({ id: 'configure', label: t('保存设置', 'Save settings'), advanced: !missingConfig.size });
    const nextAccount = job.authorizations.find(row => row.state !== 'connected');
    let offeredAuthorization = false;
    const guideSteps: string[] = [];
    const guideLinks: { label: string; url: string }[] = [];
    if (missingConfig.size > 0) {
      guideSteps.push(t('先填写下方必填配置项并点击「保存设置」。', 'Fill in the required fields below and tap Save settings.'));
    }
    for (const { account, method, key } of methods) {
      if (job.authorizations.find(row => row.id === account.id)?.state === 'connected') continue;
      const advanced = missingConfig.size > 0 || account.id !== nextAccount?.id || offeredAuthorization;
      if (!advanced) {
        offeredAuthorization = true;
        if (account.description?.trim()) guideSteps.push(account.description.trim());
        for (const line of method.instructions) {
          if (line.trim()) guideSteps.push(line.trim());
        }
        if (method.helpUrl) {
          guideLinks.push({ label: t('查看配置说明', 'View setup guide'), url: method.helpUrl });
        }
      }
      if (method.type === 'form') {
        for (const field of method.fields) if (!result.fields.some(existing => existing.id === field)) {
          const spec = pkg.layout?.userConfig?.[field];
          result.fields.push({
            ...text(field, spec?.title ?? field, '', 'secret'),
            ...(spec?.description ? { description: spec.description } : {}),
            ...(spec?.required ? { required: true } : {}),
            advanced,
            hint: saved[field] ? t('留空保留现有凭据', 'Leave blank to keep the saved credential') : undefined,
          });
        }
        actions.push({ id: 'credentials:' + key, label: t('保存并连接', 'Save and connect'), advanced });
      } else {
        actions.push({ id: 'authorize:' + key, label: t('连接 ', 'Connect ') + account.title, advanced });
        const state = job.authorizations.find(row => row.id === account.id);
        if (state?.method === method.id && state.state === 'pending') {
          actions.push({ id: 'status:' + key, label: t('继续授权 · ', 'Resume sign-in · ') + account.title, advanced: true });
        }
      }
    }
    for (const row of job.connections.filter(value => directServers.includes(value.name))) {
      if (row.state === 'oauth_required' || row.authorizationId && row.state !== 'connected') {
        const key = serverKey(row.name);
        actions.push({ id: 'authorize-server:' + key, label: t('连接账号', 'Connect account'), advanced: missingConfig.size > 0 || offeredAuthorization });
        if (row.authorizationId) actions.push({ id: 'status-server:' + key, label: t('继续授权', 'Resume sign-in'), advanced: true });
        offeredAuthorization = true;
      }
    }
    const needsVerification = job.missingConfig.length > 0 || job.connections.some(row => row.state !== 'connected')
      || job.authorizations.some(row => row.state !== 'connected');
    if (guideSteps.length) result.steps = [...new Set(guideSteps)];
    const validLinks = safePanelLinks(guideLinks);
    if (validLinks) result.links = validLinks;
    if (needsVerification) {
      result.message = signInState === 'error' || job.error
        ? t('连接还未完成。请确认服务商授权已完成，再刷新状态。', 'Finish signing in with the provider, then refresh the connection status.')
        : t('完成以下设置即可使用。', 'Finish setup to use this plugin.');
      if (!actions.some(action => !action.advanced)) actions.push({ id: 'verify', label: t('重试连接', 'Retry connection') });
    } else if (!active && pkg.diagnostics.length === 0) {
      actions.push({ id: 'complete', label: t('启用插件', 'Enable plugin') });
    }
    return result;
  }

  function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  function channelAccount(id: string, config: Record<string, unknown>): string | undefined {
    const accounts = record(config.accounts);
    if (typeof config.defaultAccount === 'string' && Object.hasOwn(accounts, config.defaultAccount)) return config.defaultAccount;
    if (Object.hasOwn(accounts, 'default')) return 'default';
    return Object.keys(accounts)[0] ?? (id === 'telegram' ? 'default' : undefined);
  }

  async function probeChannelSetupForm(
    id: string,
    cfg: typeof service.currentConfig,
    actionId: 'setup.manual' | 'setup.start' | undefined,
    locale: string | undefined,
  ): Promise<{
    message?: string;
    setupLink?: { url: string; label: string };
    setupTemplate?: { content: string; url: string };
  } | undefined> {
    if (!actionId) return undefined;
    try {
      const runtime = await service.ensureChannelRuntimePlugin(id);
      const response = await runtime?.runtimeActions?.runAction({ cfg, actionId, locale, input: {} });
      if (!response?.ok || response.payload?.type !== 'form') return undefined;
      return {
        message: typeof response.payload.message === 'string' && response.payload.message.trim()
          ? response.payload.message.trim() : undefined,
        setupLink: response.payload.setupLink,
        setupTemplate: response.payload.setupTemplate,
      };
    } catch {
      return undefined;
    }
  }

  function channelFallbackGuidance(id: string, manual: boolean, t: Translator): { steps?: string[]; links?: PanelLink[] } {
    if (id === 'weixin') {
      return {
        steps: [
          t('点击下方「配对微信」生成登录二维码。', 'Tap Pair WeChat to generate a login QR code.'),
          t('保存二维码后在微信扫一扫相册选图，或用另一台设备扫码确认。', 'Save the QR code and scan it from Photos in WeChat, or scan with another device.'),
          t('配对成功后返回本页面，即可在微信里与助理对话。', 'Return here after confirming to start chatting in WeChat.'),
        ],
      };
    }
    if (id === 'telegram') {
      return {
        steps: [
          t('打开 Telegram 中的 @BotFather，发送 /newbot 创建机器人。', 'Open @BotFather in Telegram and send /newbot to create a bot.'),
          t('复制生成的 Bot Token，粘贴到下方输入框。', 'Copy the generated Bot Token and paste it below.'),
          t('点击「连接」校验令牌，随后给机器人发私聊消息完成配对。', 'Tap Connect to verify the token, then send the bot a DM to pair.'),
        ],
        links: safePanelLinks([{ label: t('打开 BotFather', 'Open BotFather'), url: 'https://t.me/BotFather' }]),
      };
    }
    if (id === 'discord') {
      return {
        steps: [
          t('打开 Discord 开发者后台创建应用，并在 Bot 页面重置复制 Bot Token。', 'Open the Discord Developer Portal, create an app, and copy the Bot Token from the Bot page.'),
          t('将 Bot Token 粘贴到下方并点击「连接」。', 'Paste the Bot Token below and tap Connect.'),
          t('连接成功后可将机器人邀请进服务器，或直接私聊完成配对。', 'After connecting, invite the bot to a server or DM it to pair.'),
        ],
        links: safePanelLinks([{ label: t('打开 Discord 开发者后台', 'Open Discord Developer Portal'), url: 'https://discord.com/developers/applications' }]),
      };
    }
    if (id === 'slack') {
      return {
        steps: [
          t('打开 Slack 应用后台使用 App Manifest 创建应用，并安装到目标工作区。', 'Open Slack Apps, create an app from the App Manifest, and install it to your workspace.'),
          t('复制 Bot User OAuth Token（xoxb-）并填入下方 Bot Token。', 'Copy the Bot User OAuth Token (xoxb-) into Bot Token below.'),
          t('在 Basic Information 开启 Socket Mode，生成含 connections:write 权限的 App Token（xapp-）填入下方。', 'Enable Socket Mode in Basic Information and generate an App Token (xapp-) with connections:write.'),
        ],
        links: safePanelLinks([{ label: t('打开 Slack 应用后台', 'Open Slack Apps'), url: 'https://api.slack.com/apps' }]),
      };
    }
    if (!manual) {
      return {
        steps: [
          t('点击下方「开始连接」生成授权二维码或验证链接。', 'Tap Start connection to generate a QR code or verification link.'),
          t('在对应应用中确认授权后返回，配置会自动保存。', 'Confirm authorization in the app and return; settings save automatically.'),
          t('如需改用已有机器人凭据，也可选择「手动连接」。', 'If you already have bot credentials, choose Connect manually instead.'),
        ],
      };
    }
    return {
      steps: [
        t('在对应开放平台创建机器人应用，获取下方所需的凭据字段。', 'Create a bot application in the provider console and copy the required credentials below.'),
        t('填写完整后点击「连接」，系统会自动验证并启用通道。', 'Fill in the fields below and tap Connect to verify and enable the channel.'),
      ],
    };
  }

  async function channel(c: Context, id: string, t: Translator, command?: Command): Promise<Panel> {
    const before = service.currentConfig;
    const locale = c.req.query('locale');
    const raw = record(before.channels?.[id]);
    const accountId = channelAccount(id, raw);
    const scopeConfig = accountId ? { ...raw, ...record(record(raw.accounts)[accountId]) } : raw;
    const snapshot = service.getExtensionLoader()?.getManifestSnapshot();
    const catalog = snapshot ? buildChannelCatalogFromSnapshot(snapshot, { locale }) : buildChannelCatalogForConfig(before, { locale });
    const entry = catalog.byId.get(id);
    const descriptor = resolveChannelDescriptor(id, entry);
    const configured = getChannelSetupStatus(before, id, entry);
    if (!descriptor) {
      return { message: t('此通道当前没有可用的移动端配置流程。', 'This channel has no mobile setup flow.') };
    }
    const pairable = descriptor.pairable;
    const isLoginQr = descriptor.qrMode === 'login';
    let qr: Panel = {};
    let paired = false;
    let pairFailure: string | undefined;
    const principal = getGatewayPrincipal(c).principalId;
    if (!command) {
      const active = [...flows].reverse().find(([, flow]) =>
        flow.channel === id && flow.principal === principal && flow.expires > Date.now());
      if (active) {
        const [flow, pending] = active;
        return channelPairPanel({
          flow,
          qrUrl: pending.needsCode ? undefined : pending.qrUrl,
          authorizationUrl: pending.needsCode ? undefined : pending.authorizationUrl,
          deviceVerificationCode: pending.needsCode ? undefined : pending.deviceVerificationCode,
          expiresAt: pending.expires,
          message: pending.message,
          fields: pending.needsCode ? [text('code', t('微信验证码', 'WeChat verification code'))] : undefined,
        }, t);
      }
    }
    if (command && pairable && ['pair', 'pair-status', 'pair-code', 'pair-cancel'].includes(command.action)) {
      const pairActions: Record<string, string> = isLoginQr
        ? { pair: 'login.start', 'pair-status': 'login.status', 'pair-code': 'login.verify-code', 'pair-cancel': 'login.cancel' }
        : { pair: 'setup.start', 'pair-status': 'setup.status', 'pair-cancel': 'setup.cancel' };
      const actionId = pairActions[command.action];
      if (!actionId) throw new McpDraftError(400, t('请选择当前配对步骤。', 'Choose the current pairing step.'));
      const flow = command.flow;
      const stored = flow ? flows.get(flow) : undefined;
      if (command.action !== 'pair' && (!stored || stored.channel !== id || stored.principal !== principal || stored.expires <= Date.now())) {
        return { ...await channel(c, id, t), message: t('配置已过期，请重新连接。', 'Setup expired. Connect again.') };
      }
      const adapter = await service.ensureChannelRuntimePlugin(id);
      if (!adapter?.runtimeActions) throw new McpDraftError(404, 'Channel is unavailable.');
      const action = await adapter.runtimeActions.runAction({ cfg: before, actionId, locale,
        ...(id === 'feishu' ? { accountId: stored?.accountId ?? accountId } : {}),
        input: flow ? { conversationId: flow, code: command.values.code } : undefined });
      if (!action.ok) throw new McpDraftError(400, action.message ?? 'Pairing failed.');
      let payload = action.payload;
      if (!isLoginQr && payload?.type === 'form') {
        const panel = await channel(c, id, t, { action: 'manual', values: {} });
        return { ...panel, message: payload.message ?? panel.message };
      }
      if (action.nextConfig) {
        const saved = await withGatewayConfigWriteLock(service, () =>
          service.saveConfig(action.nextConfig!, before, action.beforeConfigSaved));
        if (!saved.saved) throw new McpDraftError(409, 'Channel settings changed. Start again.');
        paired = true;
        const refreshed = await action.onConfigSaved?.();
        if (refreshed) payload = refreshed;
      }
      if (flow && (command.action === 'pair-cancel' || action.nextConfig)) flows.delete(flow);
      if (payload?.type === 'qr') {
        const qrUrl = safeLink(payload.qrPayload ?? payload.qrcodeUrl);
        if (!qrUrl) throw new McpDraftError(400, t('未能生成二维码，请重试。', 'Could not generate a QR code. Try again.'));
        for (const [key, value] of flows) {
          if (value.expires <= Date.now() || (value.principal === principal && value.channel === id)) flows.delete(key);
        }
        if (flows.size >= 128) flows.delete(flows.keys().next().value!);
        const authorizationUrl = safeLink(payload.deviceVerification?.url);
        const deviceVerificationCode = authorizationUrl ? payload.deviceVerification?.userCode : undefined;
        const expiresAt = Date.now() + Math.min(payload.expiresInSec ?? 300, 300) * 1000;
        qr = { flow: payload.conversationId, qrUrl, authorizationUrl, deviceVerificationCode, expiresAt,
          message: authorizationUrl
            ? t('请在验证页完成授权，返回后会自动更新。', 'Complete authorization on the verification page. The status updates when you return.')
            : t('请用对应应用扫描二维码。', 'Scan this QR code with the service’s app.') };
        flows.set(payload.conversationId, { principal, channel: id,
          accountId: typeof payload.accountId === 'string' ? payload.accountId : accountId,
          expires: expiresAt, qrUrl, authorizationUrl, deviceVerificationCode, message: qr.message });
      }
      if (payload?.type === 'poll' && payload.phase === 'pending' && flow && !action.nextConfig) {
        const updatedUrl = safeLink(payload.qrPayload ?? payload.qrcodeUrl);
        if (stored) {
          if (updatedUrl) stored.qrUrl = updatedUrl;
          stored.needsCode = Boolean(payload.pinAction);
          stored.message = payload.message ?? stored.message;
        }
        qr = { flow, qrUrl: payload.pinAction ? undefined : stored?.qrUrl,
          authorizationUrl: payload.pinAction ? undefined : stored?.authorizationUrl,
          deviceVerificationCode: payload.pinAction ? undefined : stored?.deviceVerificationCode,
          expiresAt: stored?.expires, message: payload.message ?? stored?.message,
          fields: payload.pinAction ? [text('code', t('微信验证码', 'WeChat verification code'))] : [] };
      } else if (payload?.type === 'poll' && !paired) {
        if (flow) flows.delete(flow);
        pairFailure = payload.message;
      }
    }
    if (paired) return { ...await channel(c, id, t),
      message: id === 'weixin' ? t('微信已配对并保存。', 'WeChat paired and saved.')
        : id === 'feishu' ? t('飞书授权已保存。', 'Feishu authorization saved.')
          : t('通道已配对并保存。', 'Channel paired and saved.') };
    if (pairFailure) return { ...await channel(c, id, t), message: pairFailure };
    if (command?.action === 'save' || command?.action === 'connect') {
      const connecting = command.action === 'connect';
      let connectedSetupLink: { url: string; label: string } | undefined;
      let connectedNotice: string | undefined;
      await withGatewayConfigWriteLock(service, async () => {
        const previous = service.currentConfig;
        let next = structuredClone(previous);
        const enabled = connecting || command.values.enabled === 'true';
        let afterSave: (() => unknown | Promise<unknown>) | undefined;
        let beforeSave: (() => unknown | Promise<unknown>) | undefined;
        const savedCredentials = record(previous.channels?.[id]);
        if (descriptor.usesManualAction && descriptor.credentials.some(({ key, secret }) => {
          const submitted = command.values[key]?.trim();
          return submitted && (secret || submitted !== savedCredentials[key]);
        })) {
          const values = Object.fromEntries(descriptor.credentials.map(({ key }) =>
            [key, command.values[key]?.trim() || (typeof savedCredentials[key] === 'string' ? savedCredentials[key] : '')]));
          if (Object.values(values).some(value => !value)) {
            throw new McpDraftError(400, t('请填写完整的机器人凭据。', 'Enter all the bot credentials.'));
          }
          const runtime = await service.ensureChannelRuntimePlugin(id);
          const verified = await runtime?.runtimeActions?.runAction({
            cfg: previous, actionId: 'setup.manual', locale, input: values,
          });
          if (!verified?.ok || !verified.nextConfig) throw new McpDraftError(400, verified?.message
            ?? t('暂时无法验证凭据，请重试。', 'Could not verify the credentials. Try again.'));
          next = verified.nextConfig;
          beforeSave = verified.beforeConfigSaved;
          afterSave = verified.onConfigSaved;
          if (verified.payload?.type === 'ok') {
            if (verified.payload.setupLink) connectedSetupLink = verified.payload.setupLink;
            if (typeof verified.payload.message === 'string' && verified.payload.message.trim()) {
              connectedNotice = verified.payload.message.trim();
            }
          }
        }
        const changes: Record<string, unknown> = { ...record(next.channels?.[id]), enabled };
        const selectedAccount = channelAccount(id, changes);
        const accounts = record(changes.accounts);
        const form: Record<string, unknown> = selectedAccount ? { ...record(accounts[selectedAccount]) } : changes;
        if (connecting && !isLoginQr) {
          const savedPreferences = selectedAccount
            ? { ...savedCredentials, ...record(record(savedCredentials.accounts)[selectedAccount]) } : savedCredentials;
          for (const key of ['dmPolicy', 'allowFrom', 'groupAllowFrom']) {
            if (Object.hasOwn(savedPreferences, key)) form[key] = savedPreferences[key];
          }
          form.groupPolicy = savedPreferences.groupPolicy ?? 'disabled';
        } else if (!isLoginQr) {
          const currentPolicy = form.groupPolicy ?? changes.groupPolicy;
          form.groupPolicy = command.values.scope === 'all-groups' && currentPolicy === 'open' ? 'open'
            : command.values.scope === 'groups' ? 'allowlist' : 'disabled';
        } else if (command.values.scope === 'pairing') {
          form.dmPolicy = 'pairing';
        }
        if (!isLoginQr && !connecting) {
          if (['pairing', 'allowlist', 'open', 'disabled'].includes(command.values.dmPolicy ?? '')) form.dmPolicy = command.values.dmPolicy;
          for (const key of ['allowFrom', 'groupAllowFrom']) {
            if (Object.hasOwn(command.values, key)) form[key] = command.values[key].split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
          }
        }
        if (id === 'telegram' && command.values.token?.trim()) {
          const botToken = command.values.token.trim();
          const adapter = await service.ensureChannelRuntimePlugin('telegram');
          const validation = await adapter?.runtimeActions?.runAction({ cfg: previous, actionId: 'setup.save',
            accountId: selectedAccount, locale, input: { botToken } });
          if (!validation?.ok) throw new McpDraftError(400, validation?.message
            ?? t('暂时无法验证机器人令牌。', 'Could not verify the bot token.'));
          form.botToken = botToken;
        }
        if (id === 'feishu') {
          const appId = command.values.appId?.trim();
          if (appId && appId !== (form.appId ?? changes.appId) && !command.values.token?.trim()) {
            throw new McpDraftError(400, t('更换应用时，请一并填写新的应用密钥。', 'Enter the new app secret when changing the app.'));
          }
          if (appId) form.appId = appId;
          if (command.values.token?.trim()) form.appSecret = command.values.token.trim();
        }
        if (selectedAccount) changes.accounts = { ...accounts, [selectedAccount]: form };
        next.channels = { ...next.channels, [id]: changes };
        if (enabled && !getChannelSetupStatus(next, id, entry).ready) {
          throw new McpDraftError(400, t('请先完成配对或填写必填信息。', 'Pair the account or fill in the required information first.'));
        }
        const saved = await service.saveConfig(next, previous, beforeSave);
        if (saved.conflict) throw new McpDraftError(409, t('通道设置已变更，请重新打开后保存。', 'Channel settings changed. Reopen the form and save again.'));
        if (!saved.saved) throw new McpDraftError(400, t('无法保存通道设置，请检查填写的信息后重试。', 'Could not save channel settings. Check the supplied information and try again.'));
        await afterSave?.();
      });
      const refreshed = await channel(c, id, t);
      const extraLinks = connectedSetupLink ? safePanelLinks([connectedSetupLink, ...(refreshed.links ?? [])]) : refreshed.links;
      const extraSteps = connectedNotice
        ? [connectedNotice, ...(refreshed.steps ?? []).filter(step => step !== connectedNotice)]
        : refreshed.steps;
      return {
        ...refreshed,
        ...(extraSteps?.length ? { steps: extraSteps } : {}),
        ...(extraLinks ? { links: extraLinks } : {}),
        message: connecting
          ? t('通道已连接。可以继续设置接收范围。', 'Channel connected. You can now set who it receives messages from.')
          : t('通道设置已保存', 'Channel settings saved'),
      };
    }
    if (qr.flow) return channelPairPanel(qr, t);
    if (isLoginQr && !configured.ready) {
      const guidance = channelFallbackGuidance(id, false, t);
      return {
        message: t('配对微信后，可在微信里与助理对话。', 'Pair WeChat to chat with the assistant there.'),
        ...(guidance.steps ? { steps: guidance.steps } : {}),
        actions: [{ id: 'pair', label: t('配对微信', 'Pair WeChat') }],
      };
    }
    const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : configured.enabled;
    const fields: Field[] = [toggle('enabled', t('启用通道', 'Enable channel'), enabled)];
    const save: PanelAction = { id: 'save', label: t('保存', 'Save') };
    const uiHints = entry?.uiHints ?? {};
    const hintHelp = (...keys: string[]): string | undefined => keys.map(key => uiHints[key]?.help).find(Boolean);
    if (isLoginQr) {
      fields.unshift({ id: 'scope', label: t('接收范围', 'Receive messages from'), type: 'select',
        value: scopeConfig.dmPolicy === 'pairing' ? 'pairing' : 'saved', options: [
          { id: 'saved', label: scopeConfig.dmPolicy === 'allowlist' ? t('已允许的账号', 'Allowed accounts')
            : scopeConfig.dmPolicy === 'disabled' ? t('不接收消息', 'No messages') : t('保留现有范围', 'Keep current access') },
          { id: 'pairing', label: t('仅已配对的账号', 'Paired accounts only') },
        ] });
    } else {
      fields.unshift({ id: 'scope', label: t('接收范围', 'Receive messages from'), type: 'select',
        value: scopeConfig.groupPolicy === 'open' ? 'all-groups' : scopeConfig.groupPolicy === 'allowlist' ? 'groups' : 'private', options: [
          { id: 'private', label: t('仅私聊', 'Direct messages') },
          { id: 'groups', label: t('私聊和指定群聊', 'Direct messages and selected groups') },
          ...(scopeConfig.groupPolicy === 'open' ? [{ id: 'all-groups', label: t('私聊和所有群聊', 'Direct messages and all groups') }] : []),
        ] });
      fields.splice(1, 0, {
        ...text('groupAllowFrom', t('已允许的群聊', 'Allowed groups'),
          Array.isArray(scopeConfig.groupAllowFrom) ? scopeConfig.groupAllowFrom.join('\n') : '', 'list'),
        hint: t('群聊 ID', 'Group ID'),
        addLabel: t('添加群聊', 'Add group'),
        description: hintHelp('groupAllowFrom', 'accounts.default.groupAllowFrom')
          ?? t('仅在已添加的群聊中响应消息。', 'Only respond in the groups listed here.'),
        visibleWhen: { field: 'scope', value: 'groups' },
      });
      if (descriptor.usesManualAction) {
        for (const { key, label, secret, description } of descriptor.credentials) {
          fields.push({
            ...text(key, label, !secret && typeof raw[key] === 'string' ? raw[key] : '', secret ? 'secret' : 'text'),
            ...(description ? { description } : {}),
            ...(!configured.ready ? { required: true } : {}),
            advanced: configured.ready,
            hint: secret && configured.ready ? t('留空保留现有凭据', 'Leave blank to keep the saved credential') : undefined,
          });
        }
      } else {
        if (id === 'feishu') {
          fields.unshift({
            ...text('appId', t('飞书应用 ID', 'Feishu App ID'), typeof scopeConfig.appId === 'string' ? scopeConfig.appId : ''),
            ...(!configured.ready ? { required: true } : {}),
            description: t('在飞书开放平台应用「凭证与基础信息」中查看 App ID。', 'Find the App ID under Credentials & Basic Info in the Feishu Open Platform.'),
            advanced: true,
          });
        }
        fields.push({
          id: 'token',
          label: id === 'telegram' ? t('机器人令牌', 'Bot token') : t('飞书应用密钥', 'Feishu app secret'),
          type: 'secret',
          ...(!configured.ready ? { required: true } : {}),
          description: id === 'telegram'
            ? (hintHelp('accounts.default.botToken', 'accounts.*.botToken') ?? t('从 Telegram @BotFather 复制的机器人令牌。', 'Bot token copied from @BotFather in Telegram.'))
            : t('在飞书开放平台应用「凭证与基础信息」中查看 App Secret。', 'Find the App Secret under Credentials & Basic Info in the Feishu Open Platform.'),
          advanced: configured.ready || id === 'feishu',
          hint: configured.ready ? t('留空保留现有凭据', 'Leave blank to keep the saved credential') : undefined,
        });
      }
      fields.push({
        id: 'dmPolicy', label: t('私聊权限', 'Direct-message access'), type: 'select',
        value: typeof scopeConfig.dmPolicy === 'string' ? scopeConfig.dmPolicy : id === 'feishu' ? 'open' : 'pairing',
        description: t('「已配对账号」模式下，新用户首次私聊机器人会收到配对码，确认后才可对话。', 'In Paired accounts mode, new users receive a pairing code on their first DM.'),
        advanced: true,
        options: [{ id: 'pairing', label: t('已配对账号', 'Paired accounts') },
          { id: 'allowlist', label: t('仅指定账号', 'Allowed accounts') },
          { id: 'open', label: t('所有账号', 'All accounts') },
          { id: 'disabled', label: t('关闭私聊', 'Disable direct messages') }],
      });
      fields.push({
        ...text('allowFrom', t('允许的账号 ID', 'Allowed account IDs'),
          Array.isArray(scopeConfig.allowFrom) ? scopeConfig.allowFrom.join('\n') : '', 'multiline'),
        advanced: true,
        hint: t('每行一个 ID', 'One ID per line'),
        description: hintHelp('allowFrom', 'accounts.default.allowFrom')
          ?? t('每行填写一个允许私聊的用户 ID。', 'Enter one allowed user ID per line.'),
        visibleWhen: { field: 'dmPolicy', value: 'allowlist' },
      });
    }
    if (!configured.ready && !isLoginQr) {
      const credentialIds = descriptor.usesManualAction
        ? descriptor.credentials.map(item => item.key)
        : (id === 'feishu' ? ['appId', 'token'] : ['token']);
      const preferences = fields.filter(field => !credentialIds.includes(field.id)).map(field => ({ ...field, advanced: true }));
      if (pairable && command?.action !== 'manual') {
        const guidance = channelFallbackGuidance(id, false, t);
        return {
          fields: preferences,
          ...(guidance.steps ? { steps: guidance.steps } : {}),
          ...(guidance.links ? { links: guidance.links } : {}),
          message: t('先连接账号，之后可以设置接收范围。', 'Connect an account first, then choose what it receives.'),
          actions: [{ id: 'pair', label: t('开始连接', 'Start connection') }, { id: 'manual', label: t('手动连接', 'Connect manually') },
            { ...save, advanced: true }],
        };
      }
      const runtimeForm = await probeChannelSetupForm(id, before, descriptor.manualFormAction, locale);
      const fallback = channelFallbackGuidance(id, true, t);
      const links = safePanelLinks([
        ...(runtimeForm?.setupLink ? [runtimeForm.setupLink] : []),
        ...(runtimeForm?.setupTemplate ? [{ label: t('打开应用创建页', 'Open app creation page'), url: runtimeForm.setupTemplate.url }] : []),
        ...(fallback.links ?? []),
      ]);
      const steps = runtimeForm?.message
        ? [runtimeForm.message, ...(fallback.steps ?? []).filter(step => step !== runtimeForm.message)]
        : fallback.steps;
      const copyable: PanelCopyable | undefined = runtimeForm?.setupTemplate
        ? {
          label: t('App Manifest 模板', 'App Manifest template'),
          content: runtimeForm.setupTemplate.content,
          note: t('复制后前往下方应用后台粘贴创建应用，再回来填写凭据。', 'Copy this template, paste it in the provider app console below, then enter the credentials here.'),
        }
        : undefined;
      return {
        message: t('填写机器人凭据即可连接。', 'Enter the bot credentials to connect.'),
        ...(steps?.length ? { steps } : {}),
        ...(links ? { links } : {}),
        ...(copyable ? { copyable } : {}),
        fields: [...fields.filter(field => credentialIds.includes(field.id)).map(field => ({ ...field, advanced: false })), ...preferences],
        actions: [{ id: 'connect', label: t('连接', 'Connect') }, { ...save, advanced: true }],
      };
    }
    const dmPolicy = typeof scopeConfig.dmPolicy === 'string' ? scopeConfig.dmPolicy : id === 'feishu' ? 'open' : 'pairing';
    const nextSteps = configured.ready && enabled
      ? [dmPolicy === 'pairing'
        ? t('已就绪：去对应应用给机器人发一条私聊消息，按提示完成配对即可对话。', 'Ready: send the bot a direct message in the app and follow the pairing prompt to start chatting.')
        : t('已就绪：现在可以直接在对应应用中与机器人对话。', 'Ready: you can now chat with the assistant directly in this app.')]
      : undefined;
    return {
      fields,
      ...(nextSteps ? { steps: nextSteps } : {}),
      message: configured.ready ? t('已配置', 'Configured') : t('待配置', 'Setup required'),
      actions: [save,
        ...(pairable ? [{ id: 'pair', label: t('重新连接', 'Reconnect'), advanced: true }] : [])],
    };
  }

  const handle = (write: boolean) => async (c: Context) => {
    const owner = getPersonalOwnerId(c);
    if (!owner) return c.json({ ok: false, error: 'A paired owner device is required.' }, 403);
    c.header('Cache-Control', 'no-store');
    const zh = (c.req.query('locale') ?? '').toLowerCase().startsWith('zh');
    const t: Translator = (cn, en) => zh ? cn : en;
    try {
      const id = stableId.parse(c.req.query('id'));
      const command = write ? schema.parse(await c.req.json()) : undefined;
      const category = c.req.param('category');
      let payload: Panel;
      switch (category) {
        case 'skills': payload = await skill(c, id, t, command); break;
        case 'agents': payload = await agent(id, owner, t, command); break;
        case 'connections': payload = await connection(c, id, t, command); break;
        case 'plugins': payload = await plugin(c, id, t, command); break;
        case 'channels': payload = await channel(c, id, t, command); break;
        default: return c.json({ ok: false, error: 'Unknown capability category.' }, 404);
      }
      return c.json({ ok: true, payload });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof McpDraftError ? error.message :
        t('配置未完成，请检查已填写的信息。', 'Could not complete setup. Check the supplied information.') },
      error instanceof McpDraftError ? error.status : 400);
    }
  };
  app.get(path, handle(false));
  app.post(path, strictRateLimitMiddleware, handle(true));
}
