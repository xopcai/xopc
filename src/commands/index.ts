/**
 * Unified Command System
 *
 * Provides a platform-agnostic command system that works across
 * Telegram, Feishu, Discord, Web UI, and CLI.
 */

// Built-in Commands (import first to avoid circular deps)
import { registerSessionCommands } from './builtins/session.js';
import { registerModelCommands } from './builtins/model.js';
import { registerSystemCommands } from './builtins/system.js';
import { registerTTSCommands } from './builtins/tts.js';
import { registerThinkingCommands } from './builtins/thinking.js';

// Types
export type {
  MessageSource,
  UnifiedMessage,
  PlatformMetadata,
  MessageAttachment,
  CommandDefinition,
  CommandCategory,
  CommandScope,
  CommandHandler,
  CommandResult,
  CommandContext,
  ReplyOptions,
  UIComponent,
  ButtonGroup,
  SelectMenu,
  ModelPicker,
  UsageDisplay,
  SessionList,
  TextInput,
  ProviderInfo,
  ModelInfo,
  UsageStats,
  SessionInfo,
  PlatformFeature,
  ChannelAdapter,
  ReplyPayload,
} from './types.js';

// Session Key
export {
  generateSessionKey,
  parseSessionKey,
  isValidSessionKey,
  getSessionDisplayName,
  getRoutingInfo,
  type SessionKeyContext,
} from './session-key.js';

// Command parsing helpers
export { normalizeTelegramCommandName } from './command-parse.js';

// Registry
export { CommandRegistry, commandRegistry } from './registry.js';
export type { CommandRegistry as CommandRegistryType } from './types.js';

// Context
export { CommandContextImpl, createCommandContext } from './context.js';

// Built-in Commands
export { registerSessionCommands } from './builtins/session.js';
export { registerModelCommands } from './builtins/model.js';
export { registerSystemCommands } from './builtins/system.js';
export { registerTTSCommands } from './builtins/tts.js';
export { registerThinkingCommands } from './builtins/thinking.js';

/**
 * Initialize the command system with all built-in commands
 */
export function initializeCommands(): void {
  registerSessionCommands();
  registerModelCommands();
  registerSystemCommands();
  registerTTSCommands();
  registerThinkingCommands();
}
