import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const harmonyRoot = path.resolve(import.meta.dirname, '..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(harmonyRoot, relativePath), 'utf8');
}

describe('Harmony chat tool concise mode', () => {
  it('keeps the outer execution summary neutral when a tool fails', () => {
    const stepsView = source('entry/src/main/ets/view/ChatStepsView.ets');

    expect(stepsView).not.toContain('chat_steps_failed');
    expect(stepsView).not.toContain('chatToolFailed');
    expect(stepsView).toContain("$r('app.string.chat_steps')");
  });

  it('does not expose raw tool input, output, or failure details', () => {
    const toolView = source('entry/src/main/ets/view/ChatToolView.ets');

    expect(toolView).not.toContain('chatToolFailureSummary');
    expect(toolView).not.toContain('chat_tool_failed');
    expect(toolView).not.toContain('chat_tool_input');
    expect(toolView).not.toContain('chat_tool_output');
    expect(toolView).not.toContain('chat_tool_show_all');
    expect(toolView).not.toContain('JSON.stringify(this.call.input');
    expect(toolView).toContain('chatToolPreview(this.call)');
  });
});
