import { describe, expect, it } from 'vitest';
import {
  chatContextStrip,
  chatHeaderIdentity,
  chatModelSubtitle,
  chatModelSubtitleParts,
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

  it('splits model subtitle parts and resolves ordinary chat header identity by agent and draft state', () => {
    const parts = chatModelSubtitleParts('Claude Sonnet 4.6', 'levels', 'medium', true, 'zh');
    expect(parts).toEqual({ name: 'Claude Sonnet 4.6', suffix: '· 中 ⚡', fullText: 'Claude Sonnet 4.6 · 中 ⚡' });

    const fastOnly = chatModelSubtitleParts('GPT-5.4', 'levels', 'off', true, 'zh');
    expect(fastOnly).toEqual({ name: 'GPT-5.4', suffix: '⚡', fullText: 'GPT-5.4 ⚡' });

    const defaultTitled = chatHeaderIdentity('重构移动端导航方案', false, 'main', 'main', '主助理', '', parts);
    expect(defaultTitled.hasConversationTitle).toBe(true);
    expect(defaultTitled.showsAvatarInPrimary).toBe(false);
    expect(defaultTitled.primaryText).toBe('重构移动端导航方案');
    expect(defaultTitled.showsAgentInSecondary).toBe(false);
    expect(defaultTitled.modelName).toBe('Claude Sonnet 4.6');
    expect(defaultTitled.modelSuffix).toBe('· 中 ⚡');

    const expertTitled = chatHeaderIdentity('重构移动端导航方案', false, 'architect', 'main', '架构专家', 'Claude', parts);
    expect(expertTitled.hasConversationTitle).toBe(true);
    expect(expertTitled.showsAvatarInPrimary).toBe(false);
    expect(expertTitled.primaryRuntimeBadge).toBe('');
    expect(expertTitled.showsAgentInSecondary).toBe(true);
    expect(expertTitled.secondaryAgentName).toBe('架构专家');
    expect(expertTitled.secondaryRuntimeBadge).toBe('Claude');
    expect(expertTitled.modelName).toBe('Claude Sonnet 4.6');

    const draft = chatHeaderIdentity('新对话', true, 'architect', 'main', '架构专家', 'Claude', parts);
    expect(draft.hasConversationTitle).toBe(false);
    expect(draft.showsAvatarInPrimary).toBe(true);
    expect(draft.primaryText).toBe('架构专家');
    expect(draft.primaryRuntimeBadge).toBe('Claude');
    expect(draft.showsAgentInSecondary).toBe(false);
    expect(draft.modelName).toBe('Claude Sonnet 4.6');
  });
});
