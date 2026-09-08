import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';

import type { BrowserRuntime } from '../../../../browser/runtime/browser-runtime.js';
import { BrowserNotReadyError } from '../../../../browser/readiness.js';
import { createBrowserUseTool } from '../tool/browser-use-tool.js';

function createTool(result: Awaited<ReturnType<BrowserRuntime['execute']>>) {
  const execute = vi.fn().mockResolvedValue(result);
  return {
    execute,
    tool: createBrowserUseTool({
      getRuntime: () => ({ execute } as unknown as BrowserRuntime),
      getTaskId: () => 'task-1',
    }),
  };
}

describe('browser_use tool', () => {
  it('exposes a provider-compatible object schema and validates each action strictly', async () => {
    const { tool, execute } = createTool({
      ok: true,
      receipt: { action: 'click', risk: 'read', durationMs: 1, verified: true },
    });

    expect(tool.parameters.type).toBe('object');
    expect(Value.Check(tool.parameters, { action: 'click' })).toBe(true);

    const result = await tool.execute('call-invalid', { action: 'click' }, undefined as never, undefined as never);
    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      kind: 'browser_error',
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('forwards a typed action and returns semantic observations', async () => {
    const observation = {
      sessionId: 'session-1', tabId: 'tab-1', revision: 2, documentId: 'doc-1',
      url: 'https://example.com', title: 'Example', nodes: [],
      changes: { added: [], changed: [], removed: [] },
    };
    const { tool, execute } = createTool({
      ok: true,
      receipt: { action: 'observe', risk: 'read', durationMs: 4, verified: true, observation },
    });
    const result = await tool.execute('call-1', { action: 'observe' }, undefined as never, undefined as never);
    expect(execute).toHaveBeenCalledWith('task-1', { action: 'observe' }, undefined);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('https://example.com') });
    expect(result.details).toMatchObject({ ok: true, receipt: { action: 'observe' } });
  });

  it('decodes strict-provider placeholder fields into the selected action', async () => {
    const { tool, execute } = createTool({
      ok: true,
      receipt: { action: 'navigate', risk: 'read', durationMs: 1, verified: true },
    });

    await tool.execute('call-strict', {
      action: 'navigate',
      sessionId: '',
      approvalId: '',
      revision: 0,
      ref: '',
      expect: {
        urlIncludes: '',
        titleIncludes: '',
        textIncludes: '',
        ref: '',
        state: 'visible',
      },
      visual: 'never',
      url: 'https://www.google.com/search?q=ai+news',
      value: '',
      submit: false,
      key: ' ',
      deltaY: 0,
      condition: 'page_idle',
      timeoutMs: 1000,
      paths: ['/'],
      operation: 'list',
      tabId: '',
      steps: [{ action: 'click', ref: '' }],
    }, undefined as never, undefined as never);

    expect(execute).toHaveBeenCalledWith('task-1', {
      action: 'navigate',
      url: 'https://www.google.com/search?q=ai+news',
    }, undefined);
  });

  it('returns screenshots as image content without copying base64 into details', async () => {
    const { tool } = createTool({
      ok: true,
      receipt: {
        action: 'observe', risk: 'read', durationMs: 4, verified: true,
        observation: {
          sessionId: 'session-1', tabId: 'tab-1', revision: 1, documentId: 'doc-1',
          url: 'https://example.com', title: 'Example', nodes: [],
          changes: { added: [], changed: [], removed: [] },
          visual: { mimeType: 'image/jpeg', data: 'base64-data' },
        },
      },
    });
    const result = await tool.execute('call-2', { action: 'observe', visual: 'always' }, undefined as never, undefined as never);
    expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/jpeg', data: 'base64-data' });
    expect(JSON.stringify(result.details)).not.toContain('base64-data');
  });

  it('short-circuits with a structured setup error', async () => {
    const execute = vi.fn();
    const tool = createBrowserUseTool({
      getRuntime: () => ({ execute } as unknown as BrowserRuntime),
      getTaskId: () => 'task-1',
      getReadiness: async () => new BrowserNotReadyError({
        driver: 'extension', reason: 'extension_not_installed', deepLink: '/settings/agent-browser?driver=extension',
      }),
    });
    const result = await tool.execute('call-3', { action: 'observe' }, undefined as never, undefined as never);
    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ ok: false, kind: 'browser_setup_required' });
  });
});
