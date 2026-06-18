/**
 * /config — read and write persistent config (~/.xopc/xopc.json) from chat.
 */

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import { parseConfigValue } from '../config-value.js';
import {
  parseConfigPath,
  getConfigValueAtPath,
  setConfigValueAtPath,
  unsetConfigValueAtPath,
} from '../config-paths.js';
import { ConfigSchema, type TelegramConfig, type WeixinConfig } from '../../config/schema.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import { parseSessionKey } from '../../routing/session-key.js';
import { resolveAllowlistMatchSimple } from '../../channels/security.js';

const log = createLogger('ConfigCommand');

const BLOCKED_WRITE_PATHS = new Set(['gateway.auth.token', 'providers']);

function isBlockedPath(path: string[]): boolean {
  const joined = path.join('.');
  for (const blocked of BLOCKED_WRITE_PATHS) {
    if (joined === blocked || joined.startsWith(`${blocked}.`)) return true;
  }
  return false;
}

function redactConfigForDisplay(plain: Record<string, unknown>): void {
  if (plain.gateway && typeof plain.gateway === 'object') {
    const gw = plain.gateway as Record<string, unknown>;
    if (gw.auth && typeof gw.auth === 'object') {
      (gw.auth as Record<string, unknown>).token = '[redacted]';
    }
  }
  if (plain.providers !== undefined) plain.providers = '[redacted]';
}

function senderMayWritePersistentConfig(ctx: CommandContext): boolean {
  const { source, senderId, isGroup, sessionKey } = ctx;
  if (source !== 'telegram' && source !== 'weixin') {
    return true;
  }

  const cfg = ctx.getConfig?.() ?? ctx.config;

  if (source === 'weixin') {
    const wx = cfg.channels?.weixin as WeixinConfig | undefined;
    if (!wx?.enabled) return false;
    const parsed = parseSessionKey(sessionKey);
    const accountId = parsed?.accountId ?? 'default';
    let allowFrom: Array<string | number> = [];
    if (wx.accounts && Object.keys(wx.accounts).length > 0) {
      const acc = wx.accounts[accountId] ?? wx.accounts['default'];
      if (!acc || acc.enabled === false) return false;
      allowFrom = [...(acc.allowFrom ?? [])];
    } else {
      allowFrom = [...(wx.allowFrom ?? [])];
    }
    if (allowFrom.length === 0) return false;
    return resolveAllowlistMatchSimple({ allowFrom, senderId }).allowed;
  }

  const tg = cfg.channels?.telegram as TelegramConfig | undefined;
  if (!tg?.enabled) return false;
  const parsed = parseSessionKey(sessionKey);
  const accountId = parsed?.accountId ?? 'default';
  let allowFrom: Array<string | number> = [];
  let groupAllowFrom: Array<string | number> = [];
  if (tg.accounts && Object.keys(tg.accounts).length > 0) {
    const acc = tg.accounts[accountId] ?? tg.accounts['default'];
    if (!acc || acc.enabled === false) return false;
    allowFrom = [...(acc.allowFrom ?? [])];
    groupAllowFrom = [...(acc.groupAllowFrom ?? [])];
  } else {
    allowFrom = [...(tg.allowFrom ?? [])];
    groupAllowFrom = [...(tg.groupAllowFrom ?? [])];
  }
  const list = isGroup && groupAllowFrom.length > 0 ? groupAllowFrom : allowFrom;
  if (list.length === 0) return false;
  return resolveAllowlistMatchSimple({ allowFrom: list, senderId }).allowed;
}

const configCommand: CommandDefinition = {
  id: 'system.config',
  name: 'config',
  aliases: ['cfg'],
  description:
    'Show or update configuration. Usage: /config show [path] | /config set path=value | /config unset path',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: [
    '/config show',
    '/config show agents.defaults.models.chat',
    '/config set agents.defaults.models.chat.primary=anthropic/claude-opus-4-5',
    '/config set agents.defaults.temperature=0.5',
    '/config unset tts',
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const rest = parts.slice(1).join(' ').trim();

    if (!action || action === 'show' || action === 'get') {
      const config = ctx.getConfig?.() ?? loadConfig(resolveConfigPath());
      const plain = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
      redactConfigForDisplay(plain);

      if (rest) {
        const parsed = parseConfigPath(rest);
        if (!parsed.ok || !parsed.path) {
          return { content: `⚠️ ${parsed.error ?? 'Invalid path.'}`, success: false };
        }
        const value = getConfigValueAtPath(plain, parsed.path);
        const rendered = JSON.stringify(value ?? null, null, 2);
        return { content: `⚙️ \`${rest}\`:\n\`\`\`json\n${rendered}\n\`\`\`` };
      }

      const json = JSON.stringify(plain, null, 2);
      return { content: `⚙️ Current config:\n\`\`\`json\n${json}\n\`\`\`` };
    }

    if (action === 'set') {
      if (!senderMayWritePersistentConfig(ctx)) {
        return {
          content: '⚠️ You are not allowed to change config from this chat surface.',
          success: false,
        };
      }
      const eqIndex = rest.indexOf('=');
      if (eqIndex <= 0) {
        return { content: '⚠️ Usage: /config set path=value', success: false };
      }
      const pathRaw = rest.slice(0, eqIndex).trim();
      const valueRaw = rest.slice(eqIndex + 1);

      const parsedPath = parseConfigPath(pathRaw);
      if (!parsedPath.ok || !parsedPath.path) {
        return { content: `⚠️ ${parsedPath.error}`, success: false };
      }
      if (isBlockedPath(parsedPath.path)) {
        return {
          content: `⚠️ Path \`${pathRaw}\` cannot be modified via chat for security reasons.`,
          success: false,
        };
      }

      const parsedValue = parseConfigValue(valueRaw);
      if (parsedValue.ok === false) {
        return { content: `⚠️ ${parsedValue.error}`, success: false };
      }

      const configPath = resolveConfigPath();
      const currentConfig = loadConfig(configPath) as Record<string, unknown>;
      setConfigValueAtPath(currentConfig, parsedPath.path, parsedValue.value);

      const validated = ConfigSchema.safeParse(currentConfig);
      if (!validated.success) {
        const firstIssue = validated.error.issues[0];
        const fieldPath = firstIssue.path.join('.');
        return {
          content: `⚠️ Config invalid after set (${fieldPath}: ${firstIssue.message}). Change not saved.`,
          success: false,
        };
      }

      await saveConfig(validated.data);
      log.info({ path: pathRaw, value: parsedValue.value }, 'Config updated via /config set');

      const valueLabel =
        typeof parsedValue.value === 'string'
          ? `"${parsedValue.value}"`
          : JSON.stringify(parsedValue.value);
      return { content: `⚙️ Config updated: \`${pathRaw}\` = ${valueLabel}` };
    }

    if (action === 'unset') {
      if (!senderMayWritePersistentConfig(ctx)) {
        return {
          content: '⚠️ You are not allowed to change config from this chat surface.',
          success: false,
        };
      }
      if (!rest) {
        return { content: '⚠️ Usage: /config unset path', success: false };
      }
      const parsedPath = parseConfigPath(rest);
      if (!parsedPath.ok || !parsedPath.path) {
        return { content: `⚠️ ${parsedPath.error}`, success: false };
      }
      if (isBlockedPath(parsedPath.path)) {
        return {
          content: `⚠️ Path \`${rest}\` cannot be modified via chat for security reasons.`,
          success: false,
        };
      }

      const configPath = resolveConfigPath();
      const currentConfig = loadConfig(configPath) as Record<string, unknown>;
      const removed = unsetConfigValueAtPath(currentConfig, parsedPath.path);
      if (!removed) {
        return { content: `⚙️ No config value found at \`${rest}\`.`, success: false };
      }

      const validated = ConfigSchema.safeParse(currentConfig);
      if (!validated.success) {
        const firstIssue = validated.error.issues[0];
        const fieldPath = firstIssue.path.join('.');
        return {
          content: `⚠️ Config invalid after unset (${fieldPath}: ${firstIssue.message}). Change not saved.`,
          success: false,
        };
      }

      await saveConfig(validated.data);
      log.info({ path: rest }, 'Config key removed via /config unset');
      return { content: `⚙️ Config updated: \`${rest}\` removed.` };
    }

    return {
      content:
        '⚙️ *Config Command*\n\n' +
        '`/config show [path]` — view config (or a specific path)\n' +
        '`/config set path=value` — update a config value\n' +
        '`/config unset path` — remove a config key\n\n' +
        'Examples:\n' +
        '`/config show agents.defaults.models.chat`\n' +
        '`/config set agents.defaults.temperature=0.5`\n' +
        '`/config set agents.defaults.thinkingDefault=medium`\n' +
        '`/config unset tts`',
    };
  },
};

export function registerConfigCommand(): void {
  commandRegistry.register(configCommand);
}
