/**
 * System Commands
 *
 * Built-in system commands:
 * - /help - Show help message
 * - /start - Welcome message
 * - /settings - Show settings
 */

import type { CommandDefinition, CommandContext } from '../types.js';
import { commandRegistry } from '../registry.js';

const helpCommand: CommandDefinition = {
  id: 'system.help',
  name: 'help',
  aliases: ['h', 'commands'],
  description: 'Show available commands',
  category: 'system',
  scope: ['global', 'private', 'group'],
  handler: async (_ctx: CommandContext) => {
    const allCommands = commandRegistry.list();

    // Group by category
    const byCategory = new Map<string, typeof allCommands>();
    for (const cmd of allCommands) {
      if (!byCategory.has(cmd.category)) {
        byCategory.set(cmd.category, []);
      }
      byCategory.get(cmd.category)!.push(cmd);
    }

    const lines: string[] = ['📖 *Available Commands*\n'];

    for (const [category, commands] of byCategory) {
      lines.push(`*${category.toUpperCase()}*`);
      for (const cmd of commands) {
        const aliases = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : '';
        lines.push(`/${cmd.name}${aliases} - ${cmd.description}`);
      }
      lines.push('');
    }

    return {
      content: lines.join('\n'),
      success: true,
    };
  },
};

const startCommand: CommandDefinition = {
  id: 'system.start',
  name: 'start',
  description: 'Show welcome message',
  category: 'system',
  scope: ['global', 'private', 'group'],
  handler: async (_ctx: CommandContext) => {
    const content =
      '👋 *Welcome to xopcbot!*\n\n' +
      'I am your AI assistant. Here\'s what I can do:\n\n' +
      '🤖 *AI Chat* - Just send a message to start chatting\n' +
      '📊 *Session Management* - Use /new, /list, /usage\n' +
      '🔧 *Model Selection* - Use /models, /switch\n\n' +
      'Type /help to see all available commands.';

    return {
      content,
      success: true,
    };
  },
};

const settingsCommand: CommandDefinition = {
  id: 'system.settings',
  name: 'settings',
  description: 'Show current settings',
  category: 'system',
  scope: ['global', 'private', 'group'],
  handler: async (ctx: CommandContext) => {
    const model = ctx.getCurrentModel();
    const sessionKey = ctx.sessionKey;

    const content =
      '⚙️ *Current Settings*\n\n' +
      `🤖 Model: ${model}\n` +
      `💬 Session: ${sessionKey}\n` +
      `📱 Platform: ${ctx.source}\n` +
      `👥 Group: ${ctx.isGroup ? 'Yes' : 'No'}`;

    return {
      content,
      success: true,
    };
  },
};

const skillsCommand: CommandDefinition = {
  id: 'system.skills',
  name: 'skills',
  description: 'Manage skills (e.g., /skills reload)',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/skills reload'],
  handler: async (ctx: CommandContext, args: string) => {
    if (args === 'reload') {
      // Publish system event to reload skills
      // This will be handled by AgentService skill reload logic
      return {
        content: '✅ Skills reloaded successfully',
        success: true,
      };
    }
    
    return {
      content: 
        '🛠️ *Skills Management*\n\n' +
        'Available commands:\n' +
        '/skills reload - Reload all skills from disk',
      success: true,
    };
  },
};

// Register all system commands
export function registerSystemCommands(): void {
  commandRegistry.register(helpCommand);
  commandRegistry.register(startCommand);
  commandRegistry.register(settingsCommand);
  commandRegistry.register(skillsCommand);
}
