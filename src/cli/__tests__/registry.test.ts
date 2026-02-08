import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry, register, formatExamples, createDefaultContext, type CLIContext } from '../registry.js';
import { Command } from 'commander';

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('register', () => {
    it('should register a command successfully', () => {
      const factory = (ctx: CLIContext) => new Command('test');

      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory,
      });

      expect(registry.getCommands()).toHaveLength(1);
      expect(registry.findById('test-cmd')).toBeDefined();
    });

    it('should throw on duplicate id', () => {
      const factory = (ctx: CLIContext) => new Command('test');

      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory,
      });

      expect(() => {
        registry.register({
          id: 'test-cmd',
          name: 'test2',
          description: 'Another test',
          factory,
        });
      }).toThrow('Command with id "test-cmd" already registered');
    });

    it('should throw on duplicate name', () => {
      const factory = (ctx: CLIContext) => new Command('test');

      registry.register({
        id: 'test-cmd-1',
        name: 'test',
        description: 'Test command',
        factory,
      });

      expect(() => {
        registry.register({
          id: 'test-cmd-2',
          name: 'test',
          description: 'Another test',
          factory,
        });
      }).toThrow('Command with name "test" already registered');
    });

    it('should allow registering commands with different ids and names', () => {
      registry.register({
        id: 'cmd-1',
        name: 'cmd1',
        description: 'Command 1',
        factory: () => new Command('cmd1'),
      });

      registry.register({
        id: 'cmd-2',
        name: 'cmd2',
        description: 'Command 2',
        factory: () => new Command('cmd2'),
      });

      expect(registry.getCommands()).toHaveLength(2);
    });
  });

  describe('getCommands', () => {
    it('should return empty array when no commands registered', () => {
      expect(registry.getCommands()).toEqual([]);
    });

    it('should return all registered commands', () => {
      registry.register({
        id: 'cmd-1',
        name: 'cmd1',
        description: 'Command 1',
        factory: () => new Command('cmd1'),
      });

      registry.register({
        id: 'cmd-2',
        name: 'cmd2',
        description: 'Command 2',
        factory: () => new Command('cmd2'),
      });

      const commands = registry.getCommands();
      expect(commands).toHaveLength(2);
      expect(commands.map(c => c.id)).toContain('cmd-1');
      expect(commands.map(c => c.id)).toContain('cmd-2');
    });

    it('should return readonly array', () => {
      registry.register({
        id: 'cmd-1',
        name: 'cmd1',
        description: 'Command 1',
        factory: () => new Command('cmd1'),
      });

      const commands = registry.getCommands();
      expect(() => {
        // @ts-expect-error Testing readonly protection
        commands.push({ id: 'test', name: 'test', description: 'test', factory: () => new Command('test') });
      }).toThrow();
    });
  });

  describe('getCommandsByCategory', () => {
    it('should return commands filtered by category', () => {
      registry.register({
        id: 'setup-cmd',
        name: 'setup',
        description: 'Setup command',
        factory: () => new Command('setup'),
        metadata: { category: 'setup' },
      });

      registry.register({
        id: 'runtime-cmd',
        name: 'runtime',
        description: 'Runtime command',
        factory: () => new Command('runtime'),
        metadata: { category: 'runtime' },
      });

      registry.register({
        id: 'another-setup',
        name: 'another-setup',
        description: 'Another setup',
        factory: () => new Command('another-setup'),
        metadata: { category: 'setup' },
      });

      const setupCommands = registry.getCommandsByCategory('setup');
      expect(setupCommands).toHaveLength(2);
      expect(setupCommands.map(c => c.id)).toContain('setup-cmd');
      expect(setupCommands.map(c => c.id)).toContain('another-setup');
    });

    it('should return empty array when no commands in category', () => {
      registry.register({
        id: 'cmd',
        name: 'cmd',
        description: 'Command',
        factory: () => new Command('cmd'),
        metadata: { category: 'runtime' },
      });

      const setupCommands = registry.getCommandsByCategory('setup');
      expect(setupCommands).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should find command by id', () => {
      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory: () => new Command('test'),
      });

      const found = registry.findById('test-cmd');
      expect(found).toBeDefined();
      expect(found?.name).toBe('test');
    });

    it('should return undefined for non-existent id', () => {
      const found = registry.findById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('findByName', () => {
    it('should find command by name', () => {
      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory: () => new Command('test'),
      });

      const found = registry.findByName('test');
      expect(found).toBeDefined();
      expect(found?.id).toBe('test-cmd');
    });

    it('should return undefined for non-existent name', () => {
      const found = registry.findByName('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('install', () => {
    it('should install commands to commander program', () => {
      const program = new Command();
      const ctx = createDefaultContext();

      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory: () => new Command('test').description('Test'),
      });

      registry.install(program, ctx);

      // Check if command was added
      const commands = program.commands;
      expect(commands.some(cmd => cmd.name() === 'test')).toBe(true);
    });

    it('should skip hidden commands', () => {
      const program = new Command();
      const ctx = createDefaultContext();

      registry.register({
        id: 'visible-cmd',
        name: 'visible',
        description: 'Visible command',
        factory: () => new Command('visible'),
      });

      registry.register({
        id: 'hidden-cmd',
        name: 'hidden',
        description: 'Hidden command',
        factory: () => new Command('hidden'),
        metadata: { hidden: true },
      });

      registry.install(program, ctx);

      const commandNames = program.commands.map(cmd => cmd.name());
      expect(commandNames).toContain('visible');
      expect(commandNames).not.toContain('hidden');
    });

    it('should pass context to factory', () => {
      const program = new Command();
      const ctx = createDefaultContext(['node', 'xopcbot', '--verbose']);
      const factorySpy = vi.fn(() => new Command('test'));

      registry.register({
        id: 'test-cmd',
        name: 'test',
        description: 'Test command',
        factory: factorySpy,
      });

      registry.install(program, ctx);

      expect(factorySpy).toHaveBeenCalledWith(ctx);
      expect(ctx.isVerbose).toBe(true);
    });

    it('should sort commands by category', () => {
      const program = new Command();
      const ctx = createDefaultContext();
      const installOrder: string[] = [];

      registry.register({
        id: 'utility-cmd',
        name: 'utility',
        description: 'Utility command',
        factory: () => {
          installOrder.push('utility');
          return new Command('utility');
        },
        metadata: { category: 'utility' },
      });

      registry.register({
        id: 'setup-cmd',
        name: 'setup',
        description: 'Setup command',
        factory: () => {
          installOrder.push('setup');
          return new Command('setup');
        },
        metadata: { category: 'setup' },
      });

      registry.register({
        id: 'runtime-cmd',
        name: 'runtime',
        description: 'Runtime command',
        factory: () => {
          installOrder.push('runtime');
          return new Command('runtime');
        },
        metadata: { category: 'runtime' },
      });

      registry.install(program, ctx);

      // Should be sorted: setup, runtime, utility
      expect(installOrder).toEqual(['setup', 'runtime', 'utility']);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      registry.register({
        id: 'setup-cmd',
        name: 'setup',
        description: 'Setup command',
        factory: () => new Command('setup'),
        metadata: { category: 'setup' },
      });

      registry.register({
        id: 'runtime-cmd',
        name: 'runtime',
        description: 'Runtime command',
        factory: () => new Command('runtime'),
        metadata: { category: 'runtime' },
      });

      registry.register({
        id: 'no-category',
        name: 'nocat',
        description: 'No category',
        factory: () => new Command('nocat'),
      });

      const stats = registry.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byCategory).toEqual({
        setup: 1,
        runtime: 1,
        uncategorized: 1,
      });
    });

    it('should return zero stats when empty', () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byCategory).toEqual({});
    });
  });
});

describe('register helper', () => {
  it('should register to global registry', () => {
    // Clear any previous registrations
    const globalRegistry = (await import('../registry.js')).registry;
    
    register({
      id: 'global-test',
      name: 'global-test',
      description: 'Global test',
      factory: () => new Command('global-test'),
    });

    expect(globalRegistry.findById('global-test')).toBeDefined();
  });
});

describe('formatExamples', () => {
  it('should format single example', () => {
    const result = formatExamples(['xopcbot test']);
    expect(result).toContain('Examples:');
    expect(result).toContain('$ xopcbot test');
  });

  it('should format multiple examples', () => {
    const result = formatExamples([
      'xopcbot test',
      'xopcbot test --option',
    ]);
    expect(result).toContain('$ xopcbot test');
    expect(result).toContain('$ xopcbot test --option');
  });

  it('should return empty string for empty array', () => {
    const result = formatExamples([]);
    expect(result).toBe('');
  });
});

describe('createDefaultContext', () => {
  it('should create context with defaults', () => {
    const ctx = createDefaultContext();

    expect(ctx.configPath).toContain('.xopcbot/config.json');
    expect(ctx.workspacePath).toContain('.xopcbot/workspace');
    expect(ctx.isVerbose).toBe(false);
    expect(ctx.argv).toEqual(process.argv);
  });

  it('should detect verbose flag', () => {
    const ctx = createDefaultContext(['node', 'xopcbot', '--verbose']);
    expect(ctx.isVerbose).toBe(true);
  });

  it('should detect short verbose flag', () => {
    const ctx = createDefaultContext(['node', 'xopcbot', '-v']);
    expect(ctx.isVerbose).toBe(true);
  });

  it('should use env vars when set', () => {
    process.env.XOPCBOT_CONFIG = '/custom/config.json';
    process.env.XOPCBOT_WORKSPACE = '/custom/workspace';

    const ctx = createDefaultContext();

    expect(ctx.configPath).toBe('/custom/config.json');
    expect(ctx.workspacePath).toBe('/custom/workspace');

    delete process.env.XOPCBOT_CONFIG;
    delete process.env.XOPCBOT_WORKSPACE;
  });
});
