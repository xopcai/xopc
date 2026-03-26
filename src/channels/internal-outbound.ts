/**
 * Synthetic `OutboundMessage.channel` for internal agent runs (e.g. heartbeat without delivery).
 * {@link ChannelManager.send} drops these without treating them as unknown plugins.
 */
export const INTERNAL_OUTBOUND_DROP_CHANNEL = '__xopcbot_internal';
