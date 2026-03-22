/**
 * Telegram extension — adapter assembly surface (verification guide: `channel.ts` owns wiring only).
 *
 * Concrete factories live under `adapters/`; runtime orchestration remains in `plugin.ts`.
 */

export { createTelegramPluginAdapters } from './adapters/index.js';
export { createTelegramGatewayAdapter } from './adapters/gateway-adapter.js';
export { createTelegramStreamingAdapter } from './adapters/streaming-adapter.js';
export { createTelegramCommandAdapter } from './adapters/command-adapter.js';
export { createTelegramGroupAdapter } from './adapters/group-adapter.js';
export { createTelegramPairingAdapter } from './adapters/pairing-adapter.js';
export type { TelegramResolvedAccount } from './adapters/types.js';
