/**
 * Thinking Commands
 * 
 * Built-in commands for thinking ability management:
 * - /think - Set thinking level
 * - /reasoning - Set reasoning visibility
 * - /verbose - Set verbose mode
 * - /status - Show current status (including thinking/reasoning/verbose)
 */

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';
import {
  normalizeThinkLevel,
  normalizeReasoningLevel,
  normalizeVerboseLevel,
  formatThinkingLevels,
  type ThinkLevel,
  type ReasoningLevel,
  type VerboseLevel,
} from '../../agent/transcript/thinking-types.js';
import type { SessionConfigStore } from '../../session/index.js';

async function setSessionAgentField<K extends 'thinkingLevel' | 'reasoningLevel' | 'verboseLevel'>(
  store: SessionConfigStore | undefined,
  sessionKey: string,
  field: K,
  value: K extends 'thinkingLevel' ? ThinkLevel : K extends 'reasoningLevel' ? ReasoningLevel : VerboseLevel,
): Promise<void> {
  if (!store) return;
  const existing = (await store.get(sessionKey)) ?? {};
  await store.set(sessionKey, { ...existing, [field]: value });
}

// Think command
const thinkCommand: CommandDefinition = {
  id: 'agent.think',
  name: 'think',
  description: 'Set thinking level (usage: /think <level>)',
  category: 'model',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/think', '/think high', '/think off', '/think adaptive'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);

    if (!args.trim()) {
      // Show current thinking level
      const currentLevel = await ctx.getThinkingLevel?.();
      
      return {
        content: `🧠 *Thinking Level*\n\n` +
          `Current: *${currentLevel || 'default'}*\n\n` +
          `Available levels:\n` +
          `• off - No thinking\n` +
          `• minimal - Minimal thinking\n` +
          `• low - Low thinking\n` +
          `• medium - Medium thinking (default)\n` +
          `• high - High thinking\n` +
          `• xhigh - Extra high (certain models)\n` +
          `• adaptive - Auto-adjust based on task\n\n` +
          `Usage: /think <level>\n` +
          `Example: /think high`,
        success: true,
      };
    }
    
    // Parse and validate the level
    const level = normalizeThinkLevel(args.trim());
    if (!level) {
      const levels = formatThinkingLevels();
      return {
        content: `❌ Invalid thinking level: ${args}\n\n` +
          `Available levels: ${levels}\n\n` +
          `Usage: /think <level>\n` +
          `Example: /think high`,
        success: false,
      };
    }
    
    await setSessionAgentField(ctx.getSessionConfigStore?.(), ctx.sessionKey, 'thinkingLevel', level);
    ctx.syncAgentThinkingLevel?.(level);

    const levelDescriptions: Record<ThinkLevel, string> = {
      off: 'No thinking',
      minimal: 'Minimal thinking effort',
      low: 'Low thinking effort',
      medium: 'Medium thinking effort',
      high: 'High thinking effort',
      xhigh: 'Extra high thinking effort',
      adaptive: 'Auto-adjust based on task complexity',
    };
    
    return {
      content: `🧠 *Thinking Level Set*\n\n` +
        `Level: *${level}*\n` +
        `${levelDescriptions[level]}\n\n` +
        `Applies for this gateway process (until restart). Persists only if you use /config set.`,
      success: true,
    };
  },
};

// Reasoning command
const reasoningCommand: CommandDefinition = {
  id: 'agent.reasoning',
  name: 'reasoning',
  description: 'Set reasoning visibility (usage: /reasoning <mode>)',
  category: 'model',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/reasoning', '/reasoning on', '/reasoning stream', '/reasoning off'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);

    if (!args.trim()) {
      // Show current reasoning level
      const currentLevel = await ctx.getReasoningLevel?.();
      
      return {
        content: `💭 *Reasoning Visibility*\n\n` +
          `Current: *${currentLevel || 'default'}*\n\n` +
          `Available modes:\n` +
          `• off - Hide reasoning\n` +
          `• on - Show reasoning after completion\n` +
          `• stream - Stream reasoning in real-time\n\n` +
          `Usage: /reasoning <mode>\n` +
          `Example: /reasoning stream`,
        success: true,
      };
    }
    
    // Parse and validate the level
    const level = normalizeReasoningLevel(args.trim());
    if (!level) {
      return {
        content: `❌ Invalid reasoning mode: ${args}\n\n` +
          `Available modes: off, on, stream\n\n` +
          `Usage: /reasoning <mode>\n` +
          `Example: /reasoning stream`,
        success: false,
      };
    }
    
    await setSessionAgentField(ctx.getSessionConfigStore?.(), ctx.sessionKey, 'reasoningLevel', level);

    const modeDescriptions: Record<ReasoningLevel, string> = {
      off: 'Hide reasoning from user',
      on: 'Show reasoning after completion',
      stream: 'Stream reasoning in real-time',
    };
    
    return {
      content: `💭 *Reasoning Visibility Set*\n\n` +
        `Mode: *${level}*\n` +
        `${modeDescriptions[level]}\n\n` +
        `Applies for this gateway process (until restart). Persists only if you use /config set.`,
      success: true,
    };
  },
};

// Verbose command
const verboseCommand: CommandDefinition = {
  id: 'agent.verbose',
  name: 'verbose',
  description: 'Toggle verbose mode (usage: /verbose [on|off|full])',
  category: 'model',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/verbose', '/verbose on', '/verbose off', '/verbose full'],
  handler: async (ctx: CommandContext, args: string) => {
    await ctx.setTyping(true);

    if (!args.trim()) {
      // Toggle verbose mode
      const currentLevel = await ctx.getVerboseLevel?.();
      const newLevel: VerboseLevel = currentLevel === 'on' ? 'off' : 'on';

      await setSessionAgentField(ctx.getSessionConfigStore?.(), ctx.sessionKey, 'verboseLevel', newLevel);

      return {
        content: `📝 *Verbose Mode*\n\n` +
          `Mode: *${newLevel}*\n\n` +
          `${newLevel === 'on' ? 'Verbose output enabled (process lifetime).' : 'Verbose output disabled (process lifetime).'}`,
        success: true,
      };
    }
    
    // Parse and validate the level
    const level = normalizeVerboseLevel(args.trim());
    if (!level) {
      return {
        content: `❌ Invalid verbose mode: ${args}\n\n` +
          `Available modes: off, on, full\n\n` +
          `Usage: /verbose [mode]\n` +
          `Example: /verbose on`,
        success: false,
      };
    }
    
    await setSessionAgentField(ctx.getSessionConfigStore?.(), ctx.sessionKey, 'verboseLevel', level);

    const modeDescriptions: Record<VerboseLevel, string> = {
      off: 'Minimal output',
      on: 'Normal verbose output',
      full: 'Full verbose output with all details',
    };

    return {
      content: `📝 *Verbose Mode Set*\n\n` +
        `Mode: *${level}*\n` +
        `${modeDescriptions[level]}\n\n` +
        `Applies for this gateway process (until restart). Persists only if you use /config set.`,
      success: true,
    };
  },
};

// Status command - enhanced to show thinking/reasoning/verbose
const enhancedStatusCommand: CommandDefinition = {
  id: 'agent.status',
  name: 'status',
  description: 'Show current agent status including thinking settings',
  category: 'system',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    await ctx.setTyping(true);

    const currentModel = ctx.getCurrentModel();
    const thinkingLevel = await ctx.getThinkingLevel?.();
    const reasoningLevel = await ctx.getReasoningLevel?.();
    const verboseLevel = await ctx.getVerboseLevel?.();
    const usage = await ctx.getUsage();
    
    // Build status message
    const lines = [
      '📊 *Agent Status*',
      '',
      `🤖 *Model:* \`${currentModel}\``,
      `🧠 *Thinking:* \`${thinkingLevel || 'default'}\``,
      `💭 *Reasoning:* \`${reasoningLevel || 'default'}\``,
      `📝 *Verbose:* \`${verboseLevel || 'default'}\``,
      '',
      '---',
      '',
      '📈 *Session Usage*',
      `💬 Messages: ${usage.messageCount}`,
      `📥 Prompt: ${usage.promptTokens.toLocaleString()} tokens`,
      `📤 Completion: ${usage.completionTokens.toLocaleString()} tokens`,
      `📊 Total: ${usage.totalTokens.toLocaleString()} tokens`,
    ];
    
    return {
      content: lines.join('\n'),
      success: true,
    };
  },
};

// Register all thinking commands
export function registerThinkingCommands(): void {
  commandRegistry.register(thinkCommand);
  commandRegistry.register(reasoningCommand);
  commandRegistry.register(verboseCommand);
  commandRegistry.register(enhancedStatusCommand);
}
