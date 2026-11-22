import { describe, expect, it } from 'vitest';

import {
  formatTaskPhase,
  formatTaskPresentationStatus,
  formatTaskRawStatus,
  formatTaskResolution,
  taskPresentationStage,
  taskStatusBadgeTone,
  taskStatusDotTone,
} from '@/features/tasks/task-status';

describe('task-status unified presentation mapping', () => {
  it('maps every presentation status to one of the 7 canonical stages', () => {
    expect(taskPresentationStage('captured')).toBe('backlog');
    expect(taskPresentationStage('ready')).toBe('ready');
    expect(taskPresentationStage('active')).toBe('in_progress');
    expect(taskPresentationStage('running')).toBe('in_progress');
    expect(taskPresentationStage('needsUser')).toBe('needs_user');
    expect(taskPresentationStage('failed')).toBe('needs_user');
    expect(taskPresentationStage('review')).toBe('review');
    expect(taskPresentationStage('completed')).toBe('completed');
    expect(taskPresentationStage('ended')).toBe('ended');
  });

  it('never leaks raw backend enums in localized labels', () => {
    expect(formatTaskRawStatus('active', 'zh')).toBe('进行中');
    expect(formatTaskRawStatus('verifying', 'zh')).toBe('正在验证');
    expect(formatTaskRawStatus('review', 'zh')).toBe('等待验收');
    expect(formatTaskRawStatus('cancelled', 'zh')).toBe('执行已取消');
    expect(formatTaskRawStatus('closed', 'zh', 'cancelled')).toBe('已取消');
    expect(formatTaskRawStatus('closed', 'en', 'done')).toBe('Done');
    expect(formatTaskPhase('backlog', 'zh')).toBe('待规划');
    expect(formatTaskResolution('wont_do', 'zh')).toBe('不做');
    expect(formatTaskPresentationStatus('active', 'en')).toBe('In progress');
  });

  it('keeps badge and dot tones semantically aligned across completed and review states', () => {
    expect(taskStatusBadgeTone('completed')).toContain('success');
    expect(taskStatusDotTone('completed')).toBe('bg-success');
    expect(taskStatusBadgeTone('review')).toContain('accent');
    expect(taskStatusDotTone('review')).toBe('bg-accent');
    expect(taskStatusBadgeTone('failed')).toContain('danger');
    expect(taskStatusDotTone('failed')).toBe('bg-danger');
  });
});
