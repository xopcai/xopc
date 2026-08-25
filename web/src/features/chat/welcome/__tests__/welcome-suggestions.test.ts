import { describe, expect, it } from 'vitest';

import { buildWelcomeSpotlight, type WelcomeSuggestionContext } from '@/features/chat/welcome/welcome-suggestions';
import { messages } from '@/i18n/messages';

const copy = messages('zh').chat.welcomeSpotlight;

function build(context: WelcomeSuggestionContext) {
  return buildWelcomeSpotlight(context, copy);
}

describe('buildWelcomeSpotlight', () => {
  it('returns three cards for empty context', () => {
    const spotlight = build({ kind: 'empty' });

    expect(spotlight.headline).toBe('今天想推进什么？');
    expect(spotlight.primaryRecommendation.title).toBe('办公输出');
    expect(spotlight.primaryRecommendation.reason).not.toContain('「」');
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '办公输出',
      '写作润色',
      '学习新主题',
    ]);
    expect(spotlight.categories.map((card) => card.scope)).toEqual(['context', 'context', 'explore']);
  });

  it('returns coding project cards with project variables filled', () => {
    const spotlight = build({
      kind: 'codingProject',
      projectId: 'p1',
      projectName: 'xopc',
      workspaceRoot: '/repo/xopc',
    });

    expect(spotlight.contextLabel).toBe('项目：xopc');
    expect(spotlight.primaryRecommendation.prompt).toContain('/repo/xopc');
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '理解代码库',
      '推进功能改动',
      '审查与排查',
    ]);
    expect(spotlight.categories[0]?.scenarios[0]?.prompt).toContain('xopc');
  });

  it('returns general project cards', () => {
    const spotlight = build({
      kind: 'generalProject',
      projectId: 'p2',
      projectName: '增长计划',
    });

    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '规划下一步',
      '梳理项目状态',
      '生成项目材料',
    ]);
  });

  it('prioritizes a project blocker over a failure and next action', () => {
    const spotlight = build({
      kind: 'codingProject',
      projectId: 'p2',
      projectName: 'xopc',
      blockedReason: 'CI is failing',
      recentFailure: 'Tests failed',
      recommendedAction: 'Publish release',
    });

    expect(spotlight.primaryRecommendation.categoryId).toBe('review-debug');
    expect(spotlight.primaryRecommendation.prompt).toContain('CI is failing');
  });

  it('returns note cards', () => {
    const spotlight = build({
      kind: 'note',
      noteId: 'n1',
      title: 'AI 工作流',
    });

    expect(spotlight.contextLabel).toBe('笔记：AI 工作流');
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '提炼笔记',
      '继续思考',
      '学习新主题',
    ]);
  });

  it('returns working directory cards', () => {
    const spotlight = build({
      kind: 'workingDirectory',
      path: '/tmp/work',
    });

    expect(spotlight.contextLabel).toBeUndefined();
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '盘点内容',
      '提炼重点',
      '学习新主题',
    ]);
  });

  it('shows code-directory recommendations only for a detected coding workspace', () => {
    const spotlight = build({ kind: 'codingWorkspace', path: '/repo/xopc' });

    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '理解代码目录',
      '找入口',
      '学习新主题',
    ]);
  });

  it('does not add a code card outside a detected coding workspace', () => {
    const spotlight = buildWelcomeSpotlight(
      { kind: 'workingDirectory', path: '/tmp/materials' },
      copy,
      { id: 'coder', name: '编程专家' },
    );

    expect(spotlight.categories.map((card) => card.id)).not.toContain('agent-coding');
  });

  it('biases empty context cards for writer agent', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, {
      id: 'writer',
      name: '写作助手',
    });

    expect(spotlight.tagline).toContain('写作助手');
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '整理成文',
      '办公输出',
      '学习新主题',
    ]);
    expect(spotlight.primaryRecommendation.title).toBe('整理成文');
    expect(spotlight.primaryRecommendation.prompt).not.toContain('「」');
  });

  it('offers coding work for a coder agent in an empty chat', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, {
      id: 'coder',
      name: 'Coding Expert',
    });

    expect(spotlight.categories[0]?.id).toBe('agent-coding');
    expect(spotlight.primaryRecommendation.title).toBe('代码落地');
  });

  it('prioritizes task attention without an exploration card', () => {
    const spotlight = build({
      kind: 'task',
      taskId: 'task-1',
      taskTitle: '发布新版本',
      phase: 'active',
      operationalState: 'waiting',
      attentionSummary: '需要确认发布日期',
    });

    expect(spotlight.primaryRecommendation.categoryId).toBe('task-clarify');
    expect(spotlight.primaryRecommendation.prompt).toContain('需要确认发布日期');
    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.every((card) => card.scope === 'context')).toBe(true);
  });

  it('prioritizes task recovery over the next action', () => {
    const spotlight = build({
      kind: 'task',
      taskId: 'task-2',
      taskTitle: '修复构建',
      phase: 'active',
      operationalState: 'blocked',
      nextAction: '重新构建',
      recentFailure: '类型检查失败',
    });

    expect(spotlight.primaryRecommendation.categoryId).toBe('task-recover');
    expect(spotlight.primaryRecommendation.prompt).toContain('类型检查失败');
  });

  it('uses edit-first recommendations for a file handoff', () => {
    const spotlight = build({ kind: 'file', fileName: 'brief.md' });

    expect(spotlight.primaryRecommendation.categoryId).toBe('file-edit');
    expect(spotlight.primaryRecommendation.prompt).toContain('brief.md');
    expect(spotlight.categories.every((card) => card.scope === 'context')).toBe(true);
  });

  it('prioritizes recovery for a failed workflow and review for a completed workflow', () => {
    const failed = build({
      kind: 'workflow',
      workflowName: 'Release',
      status: 'failed',
      recentFailure: 'Publish step timed out',
    });
    const completed = build({ kind: 'workflow', workflowName: 'Release', status: 'succeeded' });

    expect(failed.primaryRecommendation.categoryId).toBe('workflow-recover');
    expect(failed.primaryRecommendation.prompt).toContain('timed out');
    expect(completed.primaryRecommendation.categoryId).toBe('workflow-review');
  });

  it('biases note cards for researcher agent', () => {
    const spotlight = buildWelcomeSpotlight(
      {
        kind: 'note',
        noteId: 'n2',
        title: '模型选型',
      },
      copy,
      {
        id: 'researcher',
        name: '研究助手',
      },
    );

    expect(spotlight.categories).toHaveLength(3);
    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '提炼笔记',
      '调研验证',
      '学习新主题',
    ]);
    expect(spotlight.primaryRecommendation.prompt).toContain('模型选型');
  });

  it('keeps coding project cards unchanged for coder agent', () => {
    const spotlight = buildWelcomeSpotlight(
      {
        kind: 'codingProject',
        projectId: 'p3',
        projectName: 'xopc',
      },
      copy,
      { id: 'coder', name: '编程专家' },
    );

    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '理解代码库',
      '推进功能改动',
      '审查与排查',
    ]);
  });

  it('infers agent kind from custom description', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, {
      id: 'market-scan',
      name: 'Market Scan',
      description: 'Deep research, source comparison, and fact synthesis.',
    });

    expect(spotlight.categories.map((card) => card.title)).toEqual([
      '调研验证',
      '办公输出',
      '学习新主题',
    ]);
  });

  it('uses manifest responsibilities to classify a Chinese custom agent', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, {
      id: 'insight-helper',
      name: '洞察助手',
      role: '市场研究员',
      responsibilities: ['调研资料并核查事实来源'],
    });

    expect(spotlight.primaryRecommendation.title).toBe('调研验证');
    expect(spotlight.primaryRecommendation.reason).toContain('洞察助手');
  });

  it('uses prior suggestion affinity without overriding explicit context', () => {
    const generic = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, {
      affinity: { 'research:0': 35 },
    });
    expect(generic.primaryRecommendation.categoryId).toBe('research');
  });

  it('exposes loading and degraded context labels', () => {
    const loading = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, { contextStatus: 'loading' });
    const degraded = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, { contextStatus: 'degraded' });

    expect(loading.statusLabel).toContain('正在');
    expect(degraded.statusLabel).toContain('暂时不可用');
  });

  it('keeps exploration only for low-intent contexts', () => {
    const contexts: WelcomeSuggestionContext[] = [
      { kind: 'codingProject', projectId: 'p4', projectName: 'xopc', workspaceRoot: '/repo/xopc' },
      { kind: 'note', noteId: 'n4', title: '产品方向' },
      { kind: 'workingDirectory', path: '/tmp/work' },
    ];

    for (const context of contexts) {
      const spotlight = buildWelcomeSpotlight(context, copy, { id: 'main' }, { explorationSeed: 'd' });
      expect(spotlight.categories).toHaveLength(3);
      expect(spotlight.categories[0]?.scope).toBe('context');
      expect(spotlight.categories[1]?.scope).toBe('context');
      if (context.kind === 'codingProject') {
        expect(spotlight.categories[2]?.scope).toBe('context');
      } else {
        expect(spotlight.categories[2]?.scope).toBe('explore');
        expect(spotlight.categories[2]?.id).toBe('explore-news');
      }
      expect(spotlight.primaryRecommendation.categoryId).not.toMatch(/^explore-/);
    }
  });

  it('keeps exploration stable for a day and rotates on request', () => {
    const first = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, { explorationSeed: '2026-07-15' });
    const again = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, { explorationSeed: '2026-07-15' });
    const rotated = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, {
      explorationSeed: '2026-07-15',
      explorationOffset: 1,
    });

    expect(again.categories[2]?.id).toBe(first.categories[2]?.id);
    expect(rotated.categories[2]?.id).not.toBe(first.categories[2]?.id);
  });

  it('uses exploration affinity when the user has a clear preference', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, undefined, {
      explorationSeed: '2026-07-15',
      affinity: { 'explore-news:0': 24 },
    });

    expect(spotlight.categories[2]?.id).toBe('explore-news');
  });
});
