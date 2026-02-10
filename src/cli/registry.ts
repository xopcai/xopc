import type { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';

export interface CLIContext {
  configPath: string;
  workspacePath: string;
  isVerbose: boolean;
  argv: string[];
}

export function createDefaultContext(argv: string[] = process.argv): CLIContext {
  return {
    configPath: process.env.XOPCBOT_CONFIG || join(homedir(), '.xopcbot', 'config.json'),
    workspacePath: process.env.XOPCBOT_WORKSPACE || join(homedir(), '.xopcbot', 'workspace'),
    isVerbose: argv.includes('--verbose') || argv.includes('-v'),
    argv,
  };
}

export interface CommandMetadata {
  category?: 'setup' | 'runtime' | 'maintenance' | 'utility';
  hidden?: boolean;
  unstable?: boolean;
  examples?: string[];
}

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  factory: (ctx: CLIContext) => Command;
  metadata?: CommandMetadata;
}

export class CommandRegistry {
  private commands: CommandDefinition[] = [];
  private initialized = false;

  register(def: CommandDefinition): void {
    if (this.initialized) {
      console.warn(`Warning: Command "${def.id}" registered after initialization`);
    }

    const existing = this.commands.find(c => c.id === def.id);
    if (existing) {
      throw new Error(`Command with id "${def.id}" already registered (name: ${existing.name})`);
    }

    const existingName = this.commands.find(c => c.name === def.name);
    if (existingName) {
      throw new Error(`Command with name "${def.name}" already registered (id: ${existingName.id})`);
    }

    this.commands.push(def);
  }

  registerAll(defs: CommandDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  getCommands(): ReadonlyArray<CommandDefinition> {
    return this.commands;
  }

  getCommandsByCategory(category: CommandMetadata['category']): ReadonlyArray<CommandDefinition> {
    return this.commands.filter(c => c.metadata?.category === category);
  }

  findById(id: string): CommandDefinition | undefined {
    return this.commands.find(c => c.id === id);
  }

  findByName(name: string): CommandDefinition | undefined {
    return this.commands.find(c => c.name === name);
  }

  install(program: Command, ctx: CLIContext): void {
    this.initialized = true;

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
      }
    }
  }

  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const cmd of this.commands) {
      const cat = cmd.metadata?.category ?? 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    return { total: this.commands.length, byCategory };
  }
}

export const registry = new CommandRegistry();

export function register(def: CommandDefinition): void {
  registry.register(def);
}

export function formatExamples(examples: string[]): string {
  if (examples.length === 0) return '';
  return '\nExamples:\n' + examples.map(e => `  $ ${e}`).join('\n');
}
