import { describe, expect, it } from 'vitest';

import { createToolManualTool } from '../tool-manual-tool.js';

function textOf(result: Awaited<ReturnType<ReturnType<typeof createToolManualTool>['execute']>>): string {
  return result.content.map((item) => ('text' in item ? item.text : '')).join('\n');
}

describe('tool_manual tool', () => {
  it('returns the browser_use manual', async () => {
    const tool = createToolManualTool();
    const result = await tool.execute('call-1', { tool: 'browser_use' }, new AbortController().signal, undefined as never);
    const text = textOf(result);

    expect(text).toContain('Browser Tool Manual');
    expect(text).toContain('browser_use');
    expect(text).toContain('Pipeline mode');
  });

  it('returns the xopc_use manual', async () => {
    const tool = createToolManualTool();
    const result = await tool.execute('call-1', { tool: 'xopc_use' }, new AbortController().signal, undefined as never);
    const text = textOf(result);

    expect(text).toContain('XOPC Use Tool Manual');
    expect(text).toContain('note.preview_edit');
    expect(text).toContain('work_item');
  });

  it('returns a clear message for missing manuals', async () => {
    const tool = createToolManualTool();
    const result = await tool.execute('call-1', { tool: 'missing_tool' }, new AbortController().signal, undefined as never);
    const text = textOf(result);

    expect(text).toContain('No built-in manual found for tool: missing_tool');
    expect(text).toContain('browser_use');
    expect(text).toContain('xopc_use');
  });
});
