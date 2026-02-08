import { describe, it, expect } from 'vitest';

// Simple tests for core functionality

describe('xopcbot core tests', () => {
  it('should export all required modules', async () => {
    const { AgentLoop } = await import('../agent/index.js');
    const { SessionManager } = await import('../session/index.js');
    const { MessageBus } = await import('../bus/index.js');
    const { createProvider } = await import('../providers/index.js');
    const { CommandRegistry } = await import('../cli/registry.js');
    
    expect(AgentLoop).toBeDefined();
    expect(SessionManager).toBeDefined();
    expect(MessageBus).toBeDefined();
    expect(createProvider).toBeDefined();
    expect(CommandRegistry).toBeDefined();
  });

  it('should have tool classes', async () => {
    const { ReadFileTool, WriteFileTool, ListDirTool, ExecTool } = await import('../agent/tools/index.js');
    
    expect(ReadFileTool).toBeDefined();
    expect(WriteFileTool).toBeDefined();
    expect(ListDirTool).toBeDefined();
    expect(ExecTool).toBeDefined();
  });

  it('should have config functions', async () => {
    const { loadConfig, saveConfig } = await import('../config/index.js');
    
    expect(loadConfig).toBeDefined();
    expect(saveConfig).toBeDefined();
  });
});
