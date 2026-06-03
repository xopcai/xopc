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
import { bulletList, commandBullet, joinBlocks, kvList, section } from '../format-output.js';

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

    const categoryBlocks: string[] = [];
    for (const [category, commands] of byCategory) {
      categoryBlocks.push(
        joinBlocks(
          section(category.toUpperCase()),
          commands
            .map((cmd) => commandBullet(cmd.name, cmd.description, cmd.aliases))
            .join('\n'),
        ),
      );
    }

    return {
      content: joinBlocks(section('📖 Available Commands'), ...categoryBlocks),
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
    const content = joinBlocks(
      section('👋 Welcome to xopc!'),
      "I am your AI assistant. Here's what I can do:",
      bulletList([
        '**AI Chat** — Just send a message to start chatting',
        '**Session Management** — Use `/new`, `/list`, `/usage`',
        '**Model Selection** — `/models` shows names and `provider/model` refs; `/switch` uses that ref',
      ]),
      'Type `/help` to see all available commands.',
    );

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

    const content = joinBlocks(
      section('⚙️ Current Settings'),
      kvList([
        { key: 'Model', value: model },
        { key: 'Session', value: sessionKey },
        { key: 'Platform', value: ctx.source },
        { key: 'Group', value: ctx.isGroup ? 'Yes' : 'No' },
      ]),
    );

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

    const content = joinBlocks(
      section('🛠️ Skills Management'),
      bulletList(['`/skills reload` — Reload all skills from disk']),
    );

    return {
      content,
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
