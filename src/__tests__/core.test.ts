import { describe, it, expect } from 'vitest';

/**
 * 集成测试 - 验证核心模块能正确加载
 * 详细的单元测试请查看各模块的 __tests__/ 目录
 */
describe('xopcbot integration tests', () => {
  it('should load all core modules without errors', async () => {
    // Agent modules
    const { AgentLoop } = await import('../agent/index.js');
    expect(AgentLoop).toBeDefined();

    // Config modules
    const { loadConfig, saveConfig, ConfigSchema } = await import('../config/index.js');
    expect(loadConfig).toBeDefined();
    expect(saveConfig).toBeDefined();
    expect(ConfigSchema).toBeDefined();

    // CLI modules
    const { CommandRegistry } = await import('../cli/registry.js');
    expect(CommandRegistry).toBeDefined();

    // Session modules
    const { SessionManager } = await import('../session/index.js');
    expect(SessionManager).toBeDefined();

    // Cron modules
    const { CronService } = await import('../cron/index.js');
    expect(CronService).toBeDefined();

    // Provider modules
    const { createProvider } = await import('../providers/index.js');
    expect(createProvider).toBeDefined();

    // Bus modules
    const { MessageBus } = await import('../bus/index.js');
    expect(MessageBus).toBeDefined();
  });

  it('should instantiate core classes', async () => {
    const { CommandRegistry } = await import('../cli/registry.js');
    const { SessionManager } = await import('../session/index.js');
    const { ToolRegistry } = await import('../agent/tools/registry.js');

    // Should be able to instantiate
    expect(() => new CommandRegistry()).not.toThrow();
    expect(() => new SessionManager()).not.toThrow();
    expect(() => new ToolRegistry()).not.toThrow();
  });

  it('should have all tool classes available', async () => {
    const tools = await import('../agent/tools/index.js');

    expect(tools.ReadFileTool).toBeDefined();
    expect(tools.WriteFileTool).toBeDefined();
    expect(tools.EditFileTool).toBeDefined();
    expect(tools.ListDirTool).toBeDefined();
    expect(tools.ExecTool).toBeDefined();
    expect(tools.WebSearchTool).toBeDefined();
    expect(tools.WebFetchTool).toBeDefined();
    expect(tools.MessageTool).toBeDefined();
    expect(tools.SpawnTool).toBeDefined();
  });

  it('should have all CLI commands registered', async () => {
    const { registry } = await import('../cli/registry.js');

    // Import commands to trigger registration
    await import('../cli/commands/onboard.js');
    await import('../cli/commands/agent.js');
    await import('../cli/commands/gateway.js');
    await import('../cli/commands/cron.js');
    await import('../cli/commands/config.js');
    await import('../cli/commands/models.js');
    await import('../cli/commands/configure.js');

    // Verify commands are registered
    expect(registry.findByName('onboard')).toBeDefined();
    expect(registry.findByName('agent')).toBeDefined();
    expect(registry.findByName('gateway')).toBeDefined();
    expect(registry.findByName('cron')).toBeDefined();
    expect(registry.findByName('config')).toBeDefined();
    expect(registry.findByName('models')).toBeDefined();
    expect(registry.findByName('configure')).toBeDefined();
  });
});
