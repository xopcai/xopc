/**
 * Unified Command System
 *
 * Provides a platform-agnostic command system that works across
 * Telegram, Feishu, Web UI, CLI, and other channel surfaces.
 */

// Built-in Commands (import first to avoid circular deps)
import { registerSessionCommands } from './builtins/session.js';
import { registerModelCommands } from './builtins/model.js';
import { registerSystemCommands } from './builtins/system.js';
import { registerTTSCommands } from './builtins/tts.js';
import { registerThinkingCommands } from './builtins/thinking.js';
import { registerConfigCommand } from './builtins/config.js';
import { registerContextCommands } from './builtins/context.js';
import { registerGoalCommand } from './builtins/goal.js';
import { registerSubgoalCommand } from './builtins/subgoal.js';
import { registerWorkflowCommands } from './builtins/workflow.js';
import { registerReviewCommand } from './builtins/review.js';
import { registerAgentEditCommand } from './agent-edit.js';

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

// Session display helpers
export { generateSessionKey, getSessionDisplayName, type SessionKeyContext } from './session-key.js';

// Command parsing helpers
export { normalizeTelegramCommandName, parseSlashCommand } from './command-parse.js';

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
export { registerConfigCommand } from './builtins/config.js';
export { registerContextCommands } from './builtins/context.js';
export { registerGoalCommand } from './builtins/goal.js';
export { registerSubgoalCommand } from './builtins/subgoal.js';
export { registerWorkflowCommands } from './builtins/workflow.js';
export { registerReviewCommand } from './builtins/review.js';
export { registerAgentEditCommand } from './agent-edit.js';

/**
 * Initialize the command system with all built-in commands
 */
export function initializeCommands(): void {
  registerSessionCommands();
  registerModelCommands();
  registerSystemCommands();
  registerConfigCommand();
  registerContextCommands();
  registerTTSCommands();
  registerThinkingCommands();
  registerGoalCommand();
  registerSubgoalCommand();
  registerWorkflowCommands();
  registerReviewCommand();
  registerAgentEditCommand();
}
