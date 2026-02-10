import type { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';

/**
 * CLI Context - shared state passed to all commands
 */
export interface CLIContext {
  /** Config file path */
  configPath: string;
  /** Workspace directory */
  workspacePath: string;
  /** Verbose mode flag */
  isVerbose: boolean;
  /** Raw command line arguments */
  argv: string[];
}

/**
 * Create default context
 */
export function createDefaultContext(argv: string[] = process.argv): CLIContext {
  return {
    configPath: process.env.XOPCBOT_CONFIG || join(homedir(), '.xopcbot', 'config.json'),
    workspacePath: process.env.XOPCBOT_WORKSPACE || join(homedir(), '.xopcbot', 'workspace'),
    isVerbose: argv.includes('--verbose') || argv.includes('-v'),
    argv,
  };
}

/**
 * Command metadata
 */
export interface CommandMetadata {
  /** Command category */
  category?: 'setup' | 'runtime' | 'maintenance' | 'utility';
  /** Whether to hide command (internal use) */
  hidden?: boolean;
  /** Whether experimental feature */
  unstable?: boolean;
  /** Example usage */
  examples?: string[];
}

/**
 * Command definition
 */
export interface CommandDefinition {
  /** Unique identifier */
  id: string;
  /** Command name */
  name: string;
  /** Description */
  description: string;
  /** Factory function to create Commander command object */
  factory: (ctx: CLIContext) => Command;
  /** Metadata */
  metadata?: CommandMetadata;
}

/**
 * 命令注册表 - 管理所有 CLI 命令
 */
export class CommandRegistry {
  private commands: CommandDefinition[] = [];
  private initialized = false;

  /**
   * 注册命令
   */
  register(def: CommandDefinition): void {
    if (this.initialized) {
      console.warn(`Warning: Command "${def.id}" registered after initialization`);
    }

    // Check for duplicate ID
    const existing = this.commands.find(c => c.id === def.id);
    if (existing) {
      throw new Error(`Command with id "${def.id}" already registered (name: ${existing.name})`);
    }

    // Check for duplicate name
    const existingName = this.commands.find(c => c.name === def.name);
    if (existingName) {
      throw new Error(`Command with name "${def.name}" already registered (id: ${existingName.id})`);
    }

    this.commands.push(def);
  }

  /**
   * Register multiple commands
   */
  registerAll(defs: CommandDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): ReadonlyArray<CommandDefinition> {
    return this.commands;
  }

  /**
   * Get commands by category
   */
  getCommandsByCategory(category: CommandMetadata['category']): ReadonlyArray<CommandDefinition> {
    return this.commands.filter(c => c.metadata?.category === category);
  }

  /**
   * Find command by ID
   */
  findById(id: string): CommandDefinition | undefined {
    return this.commands.find(c => c.id === id);
  }

  /**
   * Find command by name
   */
  findByName(name: string): CommandDefinition | undefined {
    return this.commands.find(c => c.name === name);
  }

  /**
   * Install all commands to Commander program
   */
  install(program: Command, ctx: CLIContext): void {
    this.initialized = true;

    // Sort by category: setup -> runtime -> maintenance -> utility
    const categoryOrder = { setup: 0, runtime: 1, maintenance: 2, utility: 3 };
    const sorted = [...this.commands].sort((a, b) => {
      const orderA = categoryOrder[a.metadata?.category ?? 'utility'];
      const orderB = categoryOrder[b.metadata?.category ?? 'utility'];
      return orderA - orderB;
    });

    for (const def of sorted) {
      if (def.metadata?.hidden) continue;

      try {
        const cmd = def.factory(ctx);
        program.addCommand(cmd);
      } catch (error) {
        console.error(`Failed to register command "${def.id}":`, error);
        // Continue registering other commands, don't break
      }
    }
  }

  /**
   * Get registration statistics
   */
  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const cmd of this.commands) {
      const cat = cmd.metadata?.category ?? 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return { total: this.commands.length, byCategory };
  }
}

/**
 * 全局注册表实例
 */
export const registry = new CommandRegistry();

/**
 * 装饰器/辅助函数：快速注册命令
 * 
 * 使用方式：
 * ```typescript
 * register({
 *   id: 'my-command',
 *   name: 'my-cmd',
 *   description: 'Does something',
 *   factory: (ctx) => new Command('my-cmd').action(...),
 *   metadata: { category: 'runtime' }
 * });
 * ```
 */
export function register(def: CommandDefinition): void {
  registry.register(def);
}

/**
 * 创建标准命令的帮助文本格式化工具
 */
export function formatExamples(examples: string[]): string {
  if (examples.length === 0) return '';
  return '\nExamples:\n' + examples.map(e => `  $ ${e}`).join('\n');
}
