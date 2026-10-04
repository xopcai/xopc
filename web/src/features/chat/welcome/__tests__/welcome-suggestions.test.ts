import { describe, expect, it } from 'vitest';

import { buildWelcomeSpotlight, type WelcomeSuggestionContext } from '@/features/chat/welcome/welcome-suggestions';
import { messages } from '@/i18n/messages';

const copy = messages('zh').chat.welcomeSpotlight;

function build(context: WelcomeSuggestionContext, contextStatus: 'loading' | 'ready' | 'degraded' = 'ready') {
  return buildWelcomeSpotlight(context, copy, { contextStatus });
}

describe('buildWelcomeSpotlight', () => {
  it('keeps an unscoped new chat quiet', () => {
    const spotlight = build({ kind: 'empty' });

    expect(spotlight.headline).toBe('今天想推进什么？');
    expect(spotlight.recommendation).toBeUndefined();
  });

  it('does not infer an action from project identity alone', () => {
    const context: WelcomeSuggestionContext = {
      kind: 'project',
      projectId: 'p1',
      projectName: 'Launch',
    };

    const spotlight = build(context);

    expect(spotlight.headline).toBe('想在「Launch」里做什么？');
    expect(spotlight.recommendation).toBeUndefined();
  });

  it('prioritizes a project blocker over other continuation signals', () => {
    const spotlight = build({
      kind: 'project',
      projectId: 'p1',
      projectName: 'xopc',
      blockedReason: '等待 API 方案确认',
      recentFailure: '类型检查失败',
      recommendedAction: '更新会话页',
    });

    expect(spotlight.recommendation?.id).toBe('project-blocked');
    expect(spotlight.recommendation?.title).toContain('等待 API 方案确认');
    expect(spotlight.recommendation?.reason).toContain('xopc');
  });

  it('recommends recovery for a recent project failure', () => {
    const spotlight = build({
      kind: 'project',
      projectId: 'p1',
      projectName: 'xopc',
      recentFailure: '类型检查失败',
    });

    expect(spotlight.recommendation?.id).toBe('project-failure');
    expect(spotlight.recommendation?.prompt).toContain('类型检查失败');
  });

  it('uses an explicitly defined project next action', () => {
    const spotlight = build({
      kind: 'project',
      projectId: 'p1',
      projectName: '发布计划',
      recommendedAction: '确认发布日期',
    });

    expect(spotlight.recommendation?.id).toBe('project-next-action');
    expect(spotlight.recommendation?.title).toContain('确认发布日期');
  });

  it('prioritizes task attention before failure and next action', () => {
    const spotlight = build({
      kind: 'task',
      taskId: 't1',
      taskTitle: '发布应用',
      phase: 'active',
      operationalState: 'waiting',
      attentionSummary: '需要确认发布日期',
      recentFailure: '构建失败',
      nextAction: '上传产物',
    });

    expect(spotlight.recommendation?.id).toBe('task-attention');
    expect(spotlight.recommendation?.prompt).toContain('需要确认发布日期');
  });

  it('recommends review when a task is verifying', () => {
    const spotlight = build({
      kind: 'task',
      taskId: 't1',
      taskTitle: '欢迎页改版',
      phase: 'active',
      operationalState: 'verifying',
    });

    expect(spotlight.recommendation?.id).toBe('task-review');
  });

  it('recommends reviewing a completed workflow', () => {
    const spotlight = build({
      kind: 'workflow',
      workflowName: '发布流程',
      status: 'succeeded',
    });

    expect(spotlight.recommendation?.id).toBe('workflow-review');
    expect(spotlight.recommendation?.reason).toContain('刚刚完成');
  });

  it.each(['loading', 'degraded'] as const)('suppresses recommendations while context is %s', (status) => {
    const spotlight = build({
      kind: 'project',
      projectId: 'p1',
      projectName: '发布计划',
      recommendedAction: '确认发布日期',
    }, status);

    expect(spotlight.recommendation).toBeUndefined();
  });
});
