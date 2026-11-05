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
    expect(stepsView).toContain("$r('app.string.chat_steps_working')");
  });

  it('separates work-log narration from the final answer and stays collapsed by default', () => {
    const contentView = source('entry/src/main/ets/view/ChatMessageContent.ets');
    const stepsView = source('entry/src/main/ets/view/ChatStepsView.ets');
    const richContent = source('entry/src/main/ets/common/chatRichContent.ets');

    expect(contentView).toContain("block.presentation !== 'narration'");
    expect(richContent).toContain("block.presentation === 'pending' || block.presentation === 'narration'");
    expect(stepsView).not.toContain('this.onShowDetail(this.row)');
    expect(stepsView).not.toContain("this.reasoning === 'stream' && !!this.row.live");
    expect(stepsView).not.toContain("Text('●')");
    expect(contentView).toContain('onShowDetail: this.onShowExecution');
  });

  it('shows a compact waiting bubble only until an answer starts', () => {
    const contentView = source('entry/src/main/ets/view/ChatMessageContent.ets');
    const stepsView = source('entry/src/main/ets/view/ChatStepsView.ets');

    expect(stepsView).toContain("chat-waiting-dots-");
    expect(contentView).toContain("this.row.live && this.showWaiting && !chatAnswerStarted(this.row)");
    expect(stepsView).not.toContain('this.onShowDetail(this.row)');
    expect(stepsView).not.toContain('this.row.live ? this.steps.slice(-2)');
    expect(contentView).toContain("block.kind === 'thinking'");
    expect(contentView).toContain("block.kind === 'tool'");
    expect(contentView).toContain('(this.row.activityTools || []).length > 0');
    expect(contentView).toContain('!!this.row.executionActivity');
  });
});
