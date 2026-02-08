import type { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';

/**
 * CLI 上下文 - 传递给所有命令的共享状态
 */
export interface CLIContext {
  /** 配置文件路径 */
  configPath: string;
  /** 工作空间目录 */
  workspacePath: string;
  /** 是否详细模式 */
  isVerbose: boolean;
  /** 原始命令行参数 */
  argv: string[];
}

/**
 * 创建默认上下文
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
 * 命令元数据
 */
export interface CommandMetadata {
  /** 命令分类 */
  category?: 'setup' | 'runtime' | 'maintenance' | 'utility';
  /** 是否隐藏命令（内部使用） */
  hidden?: boolean;
  /** 是否实验性功能 */
  unstable?: boolean;
  /** 示例用法 */
  examples?: string[];
}

/**
 * 命令定义
 */
export interface CommandDefinition {
  /** 唯一标识 */
  id: string;
  /** 命令名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 创建 Commander 命令对象的工厂函数 */
  factory: (ctx: CLIContext) => Command;
  /** 元数据 */
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

    // 检查重复 ID
    const existing = this.commands.find(c => c.id === def.id);
    if (existing) {
      throw new Error(`Command with id "${def.id}" already registered (name: ${existing.name})`);
    }

    // 检查重复名称
    const existingName = this.commands.find(c => c.name === def.name);
    if (existingName) {
      throw new Error(`Command with name "${def.name}" already registered (id: ${existingName.id})`);
    }

    this.commands.push(def);
  }

  /**
   * 批量注册命令
   */
  registerAll(defs: CommandDefinition[]): void {
    for (const def of defs) {
      this.register(def);
    }
  }

  /**
   * 获取所有已注册命令
   */
  getCommands(): ReadonlyArray<CommandDefinition> {
    return this.commands;
  }

  /**
   * 按分类获取命令
   */
  getCommandsByCategory(category: CommandMetadata['category']): ReadonlyArray<CommandDefinition> {
    return this.commands.filter(c => c.metadata?.category === category);
  }

  /**
   * 根据 ID 查找命令
   */
  findById(id: string): CommandDefinition | undefined {
    return this.commands.find(c => c.id === id);
  }

  /**
   * 根据名称查找命令
   */
  findByName(name: string): CommandDefinition | undefined {
    return this.commands.find(c => c.name === name);
  }

  /**
   * 安装所有命令到 Commander program
   */
  install(program: Command, ctx: CLIContext): void {
    this.initialized = true;

    // 按分类排序：setup -> runtime -> maintenance -> utility
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
        // 继续注册其他命令，不中断
      }
    }
  }

  /**
   * 获取注册统计信息
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
