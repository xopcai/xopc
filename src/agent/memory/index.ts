export {
  buildUserContextBlock,
  sanitizeUserContextFenceEscapes,
} from './context-fence.js';
export { createMemoryManagerFromConfig } from './create-memory-manager.js';
export {
  isMemorySubsystemEnabled,
  shouldPlanUserContextThisTurn,
} from './memory-config.js';
export { MemoryManager } from './manager.js';
export { discoverMemoryPlugins } from './plugin-discovery.js';
export type { MemoryPluginMetadata } from './plugin-discovery.js';
export type { MemoryProvider, MemoryProviderInitOptions } from './provider.js';
export { StubMemoryProvider } from './stub-memory-provider.js';
export { extractAgentUserPlainText } from './user-message-text.js';
