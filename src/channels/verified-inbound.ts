import type { MessageBus } from '../infra/bus/index.js';
import type { DeviceDelegationSubject } from '../endpoint-tools/delegation.js';
import type { InboundMessage } from './transport-types.js';

type VerifiedInbound = { subject: Extract<DeviceDelegationSubject, { kind: 'channel' }>; acceptedAt: number };
const verified = new WeakMap<InboundMessage, VerifiedInbound>();

/** Only channel lifecycle code gives a plugin access to this ingress. Ordinary bus publishers cannot mark a message. */
export function verifiedChannelBus(bus: MessageBus, channel: string): MessageBus {
  function verify(message: InboundMessage, acceptedAt = Date.now()): void {
    const meta = message.metadata;
    if (message.channel === channel && channel !== 'system' && channel !== 'webchat' && channel !== 'cli'
      && typeof meta?.accountId === 'string' && typeof meta.messageId === 'string' && meta.messageId.length > 0
      && typeof meta.isGroup === 'boolean' && !meta.isCommand && !meta.isReaction && message.chat_id && message.sender_id) {
      verified.set(message, { subject: { kind: 'channel', channel, accountId: meta.accountId,
        chatId: message.chat_id, senderId: message.sender_id,
        ...(typeof meta.threadId === 'string' && meta.threadId ? { threadId: meta.threadId } : {}) }, acceptedAt });
    }
  }

  return new Proxy(bus, {
    get(target, property) {
      if (property === 'publishInbound') {
        return (message: InboundMessage, delivery?: Parameters<MessageBus['publishInbound']>[1]) => {
          verify(message);
          return target.publishInbound(message, message.channel === channel ? delivery : undefined, verify);
        };
      }
      if (property === 'restoreDurableInbound') {
        return (requestedChannel: string, scope: string) => {
          if (requestedChannel === channel) target.restoreDurableInbound(channel, scope, verify);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function verifiedChannelInbound(message: InboundMessage): VerifiedInbound | undefined {
  return verified.get(message);
}
