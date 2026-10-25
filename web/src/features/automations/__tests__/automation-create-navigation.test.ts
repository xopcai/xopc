import { searchParamsForComposerHandoff } from '@/features/chat/session/composer-handoff-params';
import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import { automationChatCreateHref } from '../automation-create-navigation';

describe('automation chat creation navigation', () => {
  it('prefills a projectless chat without automatically sending the prompt', () => {
    const href = automationChatCreateHref('  Help me schedule a task.  ');
    const url = new URL(href, 'https://xopc.local');

    expect(url.pathname).toBe('/chat/new');
    expect(url.searchParams.get('draft')).toBe('Help me schedule a task.');
    expect(url.searchParams.get('projectScope')).toBe('none');
    expect(url.searchParams.has('autoSend')).toBe(false);
  });

  it('keeps project context when creating from an embedded automation page', () => {
    const href = automationChatCreateHref('Help me schedule a task.', ' project-1 ');
    const url = new URL(href, 'https://xopc.local');

    expect(url.searchParams.get('projectId')).toBe('project-1');
    expect(url.searchParams.has('projectScope')).toBe(false);
  });

  it('provides localized interview prompts for chat creation', () => {
    const english = messages('en').automations.createWithAssistantPrompt;
    const chinese = messages('zh').automations.createWithAssistantPrompt;

    expect(english).toContain('when it should run');
    expect(chinese).toContain('何时运行');
    expect(chinese).not.toBe(english);
  });
});

it('retains the creation scene when the new route receives its conversation ID, without enabling auto-send', () => {
  const href = automationChatCreateHref('Create a draft', 'project-1');
  const handoff = new URLSearchParams(searchParamsForComposerHandoff(href.split('?')[1]));
  expect(handoff.get('setup')).toBe('automation');
  expect(handoff.get('draft')).toBe('Create a draft');
  expect(handoff.has('projectId')).toBe(false);
  expect(handoff.has('autoSend')).toBe(false);
  expect(searchParamsForComposerHandoff('?setup=arbitrary')).toBe('');
});
