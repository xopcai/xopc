import { describe, expect, it } from 'vitest';
import { PERSONAL_WORKER_RESULT_GUIDANCE, preserveTaskExecutionInstructions, taskDescriptionForDisplay } from './task-display.js';

describe('task description projection', () => {
  it('removes only the recognized host block and envelope while preserving user context', () => {
    const source = `Context before\n\n<task_brief>\nWrite the requested report.\n\n${PERSONAL_WORKER_RESULT_GUIDANCE}\n</task_brief>\n\nContext after`;
    expect(taskDescriptionForDisplay(source)).toBe('Context before\n\nWrite the requested report.\n\nContext after');
    expect(taskDescriptionForDisplay(source.replace(/\n/g, '\r\n'))).toBe(taskDescriptionForDisplay(source));
  });
  it('does not erase authored tags or headings without a recognized host block', () => {
    const source = '<task_brief>\n## Result for the originating conversation\nExplain publish_task_result\n</task_brief>';
    expect(taskDescriptionForDisplay(source)).toBe(source);
  });
  it('keeps the execution contract when the displayed brief is edited', () => {
    const saved = preserveTaskExecutionInstructions(`Original\n\n${PERSONAL_WORKER_RESULT_GUIDANCE}`, 'Updated objective');
    expect(saved).toContain(PERSONAL_WORKER_RESULT_GUIDANCE);
    expect(taskDescriptionForDisplay(saved)).toBe('Updated objective');
    expect(preserveTaskExecutionInstructions('Ordinary user text', '')).toBe('');
  });
});
