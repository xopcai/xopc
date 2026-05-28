import { describe, it, expect, vi } from 'vitest';

import { createBrowserUseTool } from '../tool/browser-use-tool.js';
import type { BrowserManager } from '../../../../browser/manager.js';

function mockPage() {
  return {
    url: () => 'https://example.com',
    title: () => Promise.resolve('Example'),
    locator: () => ({
      first: () => ({
        waitFor: () => Promise.resolve(),
        ariaSnapshot: () => Promise.resolve('- heading "Example Domain"'),
      }),
    }),
    goto: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue({}),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
    evaluate: vi.fn().mockResolvedValue('eval-result'),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function mockManager(): BrowserManager {
  return {
    getPage: vi.fn().mockResolvedValue(mockPage()),
    closePage: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    ensureBrowser: vi.fn().mockResolvedValue({}),
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    getExtensionProvider: vi.fn().mockReturnValue(null),
  } as any;
}

function createTool() {
  const manager = mockManager();
  const page = mockPage();
  return {
    tool: createBrowserUseTool({
      getManager: () => manager,
      getPageForTask: () => Promise.resolve(page),
      getTaskId: () => 'test-session',
      getConfig: () => undefined,
      notifyBrowserPageClosed: vi.fn(),
    }),
    manager,
    page,
  };
}

describe('browser_use tool', () => {
  it('has correct name and parameters', () => {
    const { tool } = createTool();
    expect(tool.name).toBe('browser_use');
    expect(tool.parameters).toBeDefined();
  });

  describe('inspect mode', () => {
    it('returns page state', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-1', { mode: 'inspect' }, undefined as any, undefined as any);
      expect(result.content[0].text).toContain('https://example.com');
      expect(result.content[0].text).toContain('Example');
      expect(result.details.ok).toBe(true);
      expect(result.details.mode).toBe('inspect');
    });
  });

  describe('close mode', () => {
    it('closes browser page', async () => {
      const { tool, manager } = createTool();
      const result = await tool.execute('call-2', { mode: 'close' }, undefined as any, undefined as any);
      expect(result.content[0].text).toContain('closed');
      expect(result.details.ok).toBe(true);
      expect(manager.closePage).toHaveBeenCalledWith('test-session');
    });
  });

  describe('command mode', () => {
    it('requires command parameter', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-3', { mode: 'command' }, undefined as any, undefined as any);
      expect(result.details.ok).toBe(false);
      expect(result.content[0].text).toContain('Missing');
    });

    it('executes a known command', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-4', { mode: 'command', command: 'press', args: { key: 'Enter' } }, undefined as any, undefined as any);
      expect(result.details.ok).toBe(true);
    });

    it('returns error for unknown command', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-5', { mode: 'command', command: 'nonexistent', args: {} }, undefined as any, undefined as any);
      expect(result.content[0].text).toContain('UNKNOWN_ACTION');
    });
  });

  describe('pipeline mode', () => {
    it('requires pipeline parameter', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-6', { mode: 'pipeline' }, undefined as any, undefined as any);
      expect(result.details.ok).toBe(false);
      expect(result.content[0].text).toContain('Missing');
    });

    it('validates with dryRun', async () => {
      const { tool } = createTool();
      const yaml = 'name: dry\npipeline:\n  - wait:\n      ms: 100';
      const result = await tool.execute('call-7', { mode: 'pipeline', pipeline: { yaml, dryRun: true } }, undefined as any, undefined as any);
      expect(result.details.ok).toBe(true);
      expect(result.content[0].text).toContain('validated');
    });

    it('loads pipeline YAML from a remote path URL', async () => {
      const { tool } = createTool();
      const yaml = 'name: remote\npipeline:\n  - wait:\n      ms: 100';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(yaml, { status: 200 })));

      try {
        const result = await tool.execute(
          'call-remote',
          { mode: 'pipeline', pipeline: { path: 'https://example.com/pipeline.yaml', dryRun: true } },
          undefined as any,
          undefined as any,
        );

        expect(result.details.ok).toBe(true);
        expect(result.content[0].text).toContain('validated');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('returns validation error for invalid YAML', async () => {
      const { tool } = createTool();
      const yaml = 'name: bad\npipeline: not-array';
      const result = await tool.execute('call-8', { mode: 'pipeline', pipeline: { yaml, dryRun: true } }, undefined as any, undefined as any);
      expect(result.content[0].text).toContain('VALIDATION_FAILED');
    });
  });

  describe('unknown mode', () => {
    it('returns error', async () => {
      const { tool } = createTool();
      const result = await tool.execute('call-9', { mode: 'unknown' as any }, undefined as any, undefined as any);
      expect(result.content[0].text).toContain('Unknown mode');
    });
  });
});
