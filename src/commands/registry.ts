/**
 * Command Registry
 * 
 * Central registry for all commands. Provides a unified way to register,
 * discover, and execute commands across all platforms.
 */

import type {
  CommandDefinition,
  CommandCategory,
  CommandContext,
  CommandResult,
} from './types.js';
import { normalizeTelegramCommandName, parseSlashCommand } from './command-parse.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CommandRegistry');

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private aliases = new Map<string, string>(); // alias -> commandId

  private static instance: CommandRegistry;

  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  /**
   * Register a command
   */
  register(command: CommandDefinition): void {
    // Check for duplicate ID
    if (this.commands.has(command.id)) {
      log.warn({ commandId: command.id }, 'Command already registered, overwriting');
    }

    // Check for duplicate name
    const existingByName = this.findByName(command.name);
    if (existingByName && existingByName.id !== command.id) {
      log.warn({ name: command.name, existingId: existingByName.id, newId: command.id }, 
        'Command name conflict');
    }

    this.commands.set(command.id, command);

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        const existingAlias = this.aliases.get(alias);
        if (existingAlias && existingAlias !== command.id) {
          log.warn({ alias, existingId: existingAlias, newId: command.id }, 
            'Command alias conflict');
        } else {
          this.aliases.set(alias, command.id);
        }
      }
    }

    log.debug({ commandId: command.id, name: command.name }, 'Command registered');
  }

  /**
   * Unregister a command
   */
  unregister(commandId: string): void {
    const command = this.commands.get(commandId);
    if (!command) return;

    // Remove aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.aliases.get(alias) === commandId) {
          this.aliases.delete(alias);
        }
      }
    }

    this.commands.delete(commandId);
    log.debug({ commandId }, 'Command unregistered');
  }

  /**
   * Get command by ID
   */
  get(commandId: string): CommandDefinition | undefined {
    return this.commands.get(commandId);
  }

  /**
   * Find command by name or alias
   */
  findByName(name: string): CommandDefinition | undefined {
    // Direct name match
    for (const cmd of this.commands.values()) {
      if (cmd.name === name) {
        return cmd;
      }
    }

    // Alias match
    const aliasedId = this.aliases.get(name);
    if (aliasedId) {
      return this.commands.get(aliasedId);
    }

    return undefined;
  }

  /**
   * Check if a command exists (by name or alias)
   */
  has(name: string): boolean {
    return !!this.findByName(name);
  }

  /**
   * Get all registered commands
   */
  list(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands by category
   */
  listByCategory(category: CommandCategory): CommandDefinition[] {
    return this.list().filter(cmd => cmd.category === category);
  }

  /**
   * Get commands available in a specific scope
   */
  listByScope(scope: 'private' | 'group'): CommandDefinition[] {
    return this.list().filter(cmd => cmd.scope.includes(scope) || cmd.scope.includes('global'));
  }

  /**
   * Execute a command
   */
  async execute(
    name: string,
    context: CommandContext,
    args: string = ''
  ): Promise<CommandResult> {
    const command = this.findByName(name);

    if (!command) {
      return {
        content: `Unknown command: /${name}\nType /help to see available commands.`,
        success: false,
      };
    }

    // Check scope
    const scope = context.isGroup ? 'group' : 'private';
    if (!command.scope.includes('global') && !command.scope.includes(scope)) {
      return {
        content: `Command /${name} is not available in ${scope} chats.`,
        success: false,
      };
    }

    log.info({ command: name, sessionKey: context.sessionKey }, 'Executing command');

    try {
      const result = await command.handler(context, args);
      
      // Normalize result
      if (!result) {
        return { content: '', success: true };
      }
      
      return {
        content: result.content,
        success: result.success ?? true,
        components: result.components,
        metadata: result.metadata,
      };
    } catch (error) {
      log.error({ command: name, error }, 'Command execution failed');
      return {
        content: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      };
    }
  }

  /**
   * Parse command from message text
   * Returns { command: string, args: string } or null if not a command
   */
  parseCommand(text: string): { command: string; args: string } | null {
    const trimmed = text.trim();

    if (trimmed.startsWith(':')) {
      const withoutPrefix = trimmed.slice(1);
      const spaceIndex = withoutPrefix.indexOf(' ');
      if (spaceIndex === -1) {
        return { command: normalizeTelegramCommandName(withoutPrefix), args: '' };
      }
      return {
        command: normalizeTelegramCommandName(withoutPrefix.slice(0, spaceIndex)),
        args: withoutPrefix.slice(spaceIndex + 1).trim(),
      };
    }

    return parseSlashCommand(text);
  }

  /**
   * Clear all registered commands (mainly for testing)
   */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
    log.debug('Command registry cleared');
  }
}

// Export singleton instance
export const commandRegistry = CommandRegistry.getInstance();
