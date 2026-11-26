import { describe, expect, it } from 'vitest';
import {
  chatContextStrip,
  chatModelSubtitle,
  shouldShowRuntimeBadge,
} from '../entry/src/main/ets/common/chatHeaderPresentation.ets';

describe('chat header presentation (Plan A)', () => {
  it('formats model subtitle with thinking effort and fast mode', () => {
    expect(chatModelSubtitle('Claude Sonnet 4.5', 'levels', 'high', true, 'zh')).toBe('Claude Sonnet 4.5 · 高 ⚡');
    expect(chatModelSubtitle('GPT-5', 'levels', 'off', false, 'en')).toBe('GPT-5');
    expect(chatModelSubtitle('GPT-5', 'toggle', 'medium', false, 'en')).toBe('GPT-5 · Med');
    expect(chatModelSubtitle('', 'levels', 'high', true, 'zh')).toBe('');
  });

  it('omits context strip for casual chats and surfaces project, task, delegated tasks, and worktree', () => {
    expect(chatContextStrip(undefined, '', 'zh')).toBeUndefined();
    expect(
      chatContextStrip(
        {
          conversationId: 'c1',
          work: {},
          sources: [],
          sourcesHasMore: false,
          environment: { kind: 'local_checkout', rootPath: '/tmp', available: true, branch: 'main' },
          unavailableSections: [],
        },
        '',
        'zh',
      ),
    ).toBeUndefined();

    const projectTask = chatContextStrip(
      {
        conversationId: 'c2',
        work: {
          project: { id: 'p1', title: 'xopc' },
          task: { id: 't1', title: '优化顶栏', phase: 'review' },
        },
        sources: [],
        sourcesHasMore: false,
        environment: { kind: 'managed_worktree', rootPath: '/tmp', available: true, branch: 'feat/header' },
        unavailableSections: [],
      },
      '',
      'zh',
    );
    expect(projectTask).toEqual({
      hasProject: true,
      projectTitle: 'xopc',
      taskText: '优化顶栏 · 待验收',
      environmentTag: '',
      needsAttention: true,
      isTaskActive: false,
      summaryText: 'xopc · 优化顶栏 · 待验收',
    });

    const delegated = chatContextStrip(
      {
        conversationId: 'c3',
        work: {
          project: { id: 'p1', title: 'xopc' },
          delegatedTaskCount: 2,
          delegatedTasks: [
            { id: 't1', title: 'A', phase: 'active', runStatus: 'running' },
            { id: 't2', title: 'B', phase: 'review' },
          ],
        },
        sources: [],
        sourcesHasMore: false,
        unavailableSections: [],
      },
      '',
      'zh',
    );
    expect(delegated?.taskText).toBe('2 项任务 · 1 待处理');
    expect(delegated?.needsAttention).toBe(true);
    expect(delegated?.isTaskActive).toBe(true);

    const worktree = chatContextStrip(
      {
        conversationId: 'c4',
        work: { project: { id: 'p1', title: 'xopc' } },
        sources: [],
        sourcesHasMore: false,
        environment: { kind: 'managed_worktree', rootPath: '/tmp', available: true, branch: 'feat/mobile' },
        unavailableSections: [],
      },
      '',
      'en',
    );
    expect(worktree?.environmentTag).toBe('Worktree · feat/mobile');
    expect(worktree?.summaryText).toBe('xopc · Worktree · feat/mobile');
  });

  it('deduplicates runtime badge when already present in agent name', () => {
    expect(shouldShowRuntimeBadge('Claude Code', 'Claude')).toBe(false);
    expect(shouldShowRuntimeBadge('前端专家', 'Claude')).toBe(true);
    expect(shouldShowRuntimeBadge('主助理', '')).toBe(false);
  });
});
