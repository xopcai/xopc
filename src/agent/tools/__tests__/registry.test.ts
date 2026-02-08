import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../registry.js';
import { Tool } from '../base.js';

// Mock tool for testing
class MockTool extends Tool {
  readonly name = 'mock_tool';
  readonly description = 'A mock tool for testing';
  readonly parameters = {
    type: 'object',
    properties: {
      input: { type: 'string' },
    },
    required: ['input'],
  };

  async execute(params: Record<string, unknown>): Promise<string> {
    return `Mock result: ${params.input}`;
  }
}

class AnotherMockTool extends Tool {
  readonly name = 'another_mock_tool';
  readonly description = 'Another mock tool';
  readonly parameters = {
    type: 'object',
    properties: {},
  };

  async execute(): Promise<string> {
    return 'Another result';
  }
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = new MockTool();
      registry.register(tool);

      expect(registry.get('mock_tool')).toBe(tool);
    });

    it('should allow registering multiple tools', () => {
      const tool1 = new MockTool();
      const tool2 = new AnotherMockTool();

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.get('mock_tool')).toBe(tool1);
      expect(registry.get('another_mock_tool')).toBe(tool2);
    });

    it('should overwrite existing tool with same name', () => {
      const tool1 = new MockTool();
      const tool2 = new MockTool();

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.get('mock_tool')).toBe(tool2);
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent tool', () => {
      expect(registry.get('non_existent')).toBeUndefined();
    });

    it('should return registered tool', () => {
      const tool = new MockTool();
      registry.register(tool);

      expect(registry.get('mock_tool')).toBe(tool);
    });
  });

  describe('toolNames', () => {
    it('should return empty array when no tools registered', () => {
      expect(registry.toolNames).toEqual([]);
    });

    it('should return all registered tool names', () => {
      registry.register(new MockTool());
      registry.register(new AnotherMockTool());

      const names = registry.toolNames;
      expect(names).toContain('mock_tool');
      expect(names).toContain('another_mock_tool');
      expect(names).toHaveLength(2);
    });
  });

  describe('getDefinitions', () => {
    it('should return empty array when no tools registered', () => {
      expect(registry.getDefinitions()).toEqual([]);
    });

    it('should return schemas for all registered tools', () => {
      registry.register(new MockTool());

      const schemas = registry.getDefinitions();
      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toEqual({
        type: 'function',
        function: {
          name: 'mock_tool',
          description: 'A mock tool for testing',
          parameters: {
            type: 'object',
            properties: {
              input: { type: 'string' },
            },
            required: ['input'],
          },
        },
      });
    });

    it('should return schemas for multiple tools', () => {
      registry.register(new MockTool());
      registry.register(new AnotherMockTool());

      const schemas = registry.getDefinitions();
      expect(schemas).toHaveLength(2);

      const names = schemas.map(s => s.function.name);
      expect(names).toContain('mock_tool');
      expect(names).toContain('another_mock_tool');
    });
  });

  describe('integration', () => {
    it('should maintain tool state through multiple operations', () => {
      const tool1 = new MockTool();
      const tool2 = new AnotherMockTool();

      // Register tools
      registry.register(tool1);
      registry.register(tool2);

      // Verify get
      expect(registry.get('mock_tool')).toBe(tool1);
      expect(registry.get('another_mock_tool')).toBe(tool2);

      // Verify toolNames
      expect(registry.toolNames).toHaveLength(2);

      // Verify definitions
      expect(registry.getDefinitions()).toHaveLength(2);
    });
  });
});
