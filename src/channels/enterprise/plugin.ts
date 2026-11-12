import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type WebSocket from 'ws';

import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import { resolveStandardPairingPath, resolveStandardAllowFromPath } from '../pairing/paths.js';
import { readAllowFromIdsSync } from '../pairing/allow-from-file.js';
import type { ChannelPlugin, ChannelPluginInitOptions, DmPolicy, GroupPolicy } from '../plugin-types.js';
import { evaluateAccess } from '../security.js';
import { redactEnterpriseChannelSecret } from './config-surface.js';
import { createEnterpriseSetup, type EnterpriseCredentials, type EnterpriseRegistration } from './setup.js';
import { record, string } from './socket.js';

const accountId = 'default';

export type EnterpriseMessage = {
  senderId: string;
  groupId?: string;
  directChatId?: string;
  threadId?: string;
  messageId: string;
  text: string;
  replyId?: string;
  reply?: (text: string) => Promise<unknown>;
};

export type EnterpriseTransport = {
  run: (signal: AbortSignal, online: (socket?: WebSocket) => void, onFailure: (message?: string) => void) => Promise<void>;
  send: (target: string, group: boolean, text: string, replyId?: string) => Promise<string>;
};

export function createEnterpriseChannel(options: {
  id: 'dingtalk' | 'wecom' | 'slack';
  label: string;
  order: number;
  credentialFields: readonly [string, string];
  credentialLabels: readonly [string, string];
  begin?: (signal: AbortSignal) => Promise<EnterpriseRegistration>;
  credentialIdIsSecret?: boolean;
  threads?: boolean;
  setupTemplate?: { content: string; url: string; instructions: { zh: string; en: string } };
  verify: (credentials: EnterpriseCredentials) => Promise<void | string>;
  transport: (credentials: EnterpriseCredentials, receive: (message: EnterpriseMessage) => Promise<void>) => EnterpriseTransport;
}): ChannelPlugin {
  const { id, label, credentialFields: [idField, secretField] } = options;
  let cfg: Config;
  let bus: MessageBus;
  let host: NonNullable<ChannelPluginInitOptions['host']>;
  let runtime: { controller: AbortController; transport: EnterpriseTransport; task: Promise<void> } | undefined;
  let online = false;

  const section = (config: Config) => record(config.channels?.[id]);
  const credentialsFor = (config: Config) => ({
    id: string(section(config)[idField]),
    secret: string(section(config)[secretField]),
    identity: options.credentialIdIsSecret ? string(section(config).credentialIdentity) || undefined : undefined,
  });
  const configured = (credentials: EnterpriseCredentials) => Boolean(credentials.id && credentials.secret);
  const pairingKey = (credentials: EnterpriseCredentials) =>
    `${accountId}-${createHash('sha256').update(credentials.identity ?? credentials.id).digest('hex').slice(0, 24)}`;
  const stop = async () => {
    const previous = runtime;
    runtime = undefined;
    online = false;
    previous?.controller.abort();
    await previous?.task;
  };

  const plugin: ChannelPlugin = {
    id,
    meta: { id, label, selectionLabel: label, docsPath: `/channels/${id}`, blurb: `${label} bot messaging`, order: options.order },
    capabilities: { chatTypes: ['direct', 'group'], reactions: false, threads: options.threads === true, media: false, nativeCommands: false, blockStreaming: false },
    reload: { configPrefixes: [`channels.${id}`] },
    config: {
      listAccountIds: (config) => configured(credentialsFor(config)) ? [accountId] : [],
      resolveAccount: (config) => ({
        accountId, enabled: section(config).enabled === true, configured: configured(credentialsFor(config)),
      }),
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => account.configured,
      defaultAccountId: () => accountId,
      describeAccount: (account) => ({ ...account, channelId: id, status: online ? 'connected' : 'disconnected' }),
    },
    configSurface: {
      buildConfigSurface(config) {
        return redactEnterpriseChannelSecret(id, section(config)) as Record<string, unknown>;
      },
    },
    runtimeActions: createEnterpriseSetup({
      channel: id,
      credentialFields: options.credentialFields,
      credentialLabels: options.credentialLabels,
      begin: options.begin,
      credentialIdIsSecret: options.credentialIdIsSecret,
      setupTemplate: options.setupTemplate,
      verify: options.verify,
    }),
    async init(init) {
      if (!init.host) throw new Error('Channel host services are unavailable');
      host = init.host;
      cfg = init.config;
      bus = init.bus;
      host.registerPairingChannelResolver(id, {
        resolvePaths: () => {
          const key = pairingKey(credentialsFor(cfg));
          return { pairingPath: resolveStandardPairingPath(id, key), allowPath: resolveStandardAllowFromPath(id, key) };
        },
      });
    },
    async start(startOptions) {
      if (runtime || (startOptions?.accountId && startOptions.accountId !== accountId)) return;
      const credentials = credentialsFor(cfg);
      if (section(cfg).enabled !== true || !configured(credentials)) return;
      const scope = JSON.stringify([accountId, options.credentialIdIsSecret ? pairingKey(credentials) : credentials.id]);
      const controller = new AbortController();
      let restored = false;
      function restoreInbox() {
        if (restored) return;
        bus.restoreDurableInbound(id, scope);
        restored = true;
      }
      const transport = options.transport(credentials, async (message) => {
        if (controller.signal.aborted) return;
        restoreInbox();
        const channel = section(cfg);
        const isGroup = Boolean(message.groupId);
        const recipient = message.groupId || message.directChatId || message.senderId;
        const chatId = `${isGroup ? 'group' : 'user'}:${recipient}`;
        const dmPolicy = (channel.dmPolicy ?? 'pairing') as DmPolicy;
        const groupPolicy = (channel.groupPolicy ?? 'allowlist') as GroupPolicy;
        const key = pairingKey(credentials);
        const allowFrom = Array.isArray(channel.allowFrom) ? channel.allowFrom : [];
        const paired = dmPolicy === 'pairing' ? readAllowFromIdsSync(resolveStandardAllowFromPath(id, key)) : [];
        const result = evaluateAccess({
          context: { channel: id, accountId, chatId, senderId: message.senderId, isGroup, isDm: !isGroup, threadId: message.threadId },
          dmPolicy, groupPolicy,
          allowFrom: [...allowFrom, ...paired],
          groupAllowFrom: Array.isArray(channel.groupAllowFrom) ? channel.groupAllowFrom : [],
        });
        if (!result.allowed) {
          if (result.reason === 'pairing-required') {
            await host.issuePairingChallenge({
              channel: id, accountId, senderId: message.senderId,
              senderIdLine: `Sender ID: ${message.senderId}`,
              pairingFilePath: resolveStandardPairingPath(id, key),
              sendPairingReply: async (text) => {
                await (message.reply ? message.reply(text) : transport.send(recipient, false, text));
              },
            });
          }
          return;
        }

        const routingConfig = options.threads && !cfg.session?.dmScope
          ? { session: { ...cfg.session, dmScope: 'per-account-channel-peer' as const } }
          : cfg;
        const { conversationId } = host.resolveRoute({
          config: routingConfig, channel: id, accountId, peerKind: isGroup ? 'group' : 'direct',
          peerId: chatId, threadId: message.threadId,
        });
        await bus.publishInbound({
          channel: id, sender_id: message.senderId, chat_id: chatId, content: message.text,
          metadata: { conversationId, accountId, messageId: message.messageId, isGroup,
            ...(message.threadId ? { threadId: message.threadId } : {}),
            ...(message.replyId ? { channelReplyId: message.replyId } : {}),
          },
        }, { scope, id: message.messageId });
      });
      // A channel with a secret credential ID first verifies the stored bot identity.
      if (!options.credentialIdIsSecret) restoreInbox();
      const task = transport.run(controller.signal, (socket) => {
        if (runtime?.controller === controller) {
          if (socket) restoreInbox();
          online = Boolean(socket);
        }
      }, (message) => host.warn(message ?? 'Channel connection failed; retrying'))
        .catch(() => host.warn('Channel transport stopped unexpectedly'));
      runtime = { controller, transport, task };
    },
    stop,
    channelIsRunning: () => online,
    async onConfigUpdated(config) {
      const changed = section(cfg).enabled !== section(config).enabled ||
        !isDeepStrictEqual(credentialsFor(cfg), credentialsFor(config));
      cfg = config;
      if (!changed) return;
      await stop();
      await plugin.start();
    },
    outbound: {
      deliveryMode: 'direct',
      textChunkLimit: 1800,
      async sendText({ to, text, accountId: targetAccount, mediaUrl, threadId, replyToId, outboundMetadata }) {
        const separator = to.indexOf(':');
        const kind = to.slice(0, separator);
        const target = to.slice(separator + 1);
        if (!runtime || !online || (targetAccount && targetAccount !== accountId)) throw new Error(`${label} is disconnected`);
        if (!target || (kind !== 'user' && kind !== 'group')) throw new Error(`Invalid ${label} target`);
        if (mediaUrl) throw new Error(`${label} only supports text delivery`);
        const reply = string(outboundMetadata?.channelReplyId) || (options.threads ? string(threadId) : '') || replyToId || undefined;
        const messageId = await runtime.transport.send(target, kind === 'group', text, reply);
        return { success: true, messageId, chatId: to };
      },
    },
  };
  return plugin;
}
