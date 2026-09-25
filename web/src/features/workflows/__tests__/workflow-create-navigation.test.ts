import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import { workflowChatCreateHref } from '../workflow-create-navigation';

describe('workflow chat creation navigation', () => {
  it('prefills a projectless chat without automatically sending the prompt', () => {
    const href = workflowChatCreateHref('  Help me build a workflow.  ');
    const url = new URL(href, 'https://xopc.local');

    expect(url.pathname).toBe('/chat/new');
    expect(url.searchParams.get('draft')).toBe('Help me build a workflow.');
    expect(url.searchParams.get('projectScope')).toBe('none');
    expect(url.searchParams.has('autoSend')).toBe(false);
  });

  it('keeps project context when creating from a project workflow page', () => {
    const href = workflowChatCreateHref('Help me build a workflow.', ' project-1 ');
    const url = new URL(href, 'https://xopc.local');

    expect(url.searchParams.get('projectId')).toBe('project-1');
    expect(url.searchParams.has('projectScope')).toBe(false);
  });

  it('provides localized creation prompts', () => {
    const english = messages('en').workflows.createWithAssistantPrompt;
    const chinese = messages('zh').workflows.createWithAssistantPrompt;

    expect(english).toContain('workflow');
    expect(chinese).toContain('工作流');
    expect(chinese).not.toBe(english);
  });
});
