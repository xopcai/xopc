// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  readNewSessionPreferences,
  rememberAgentModel,
  rememberLastChatScope,
  rememberSelectedAgent,
} from '@/features/chat/session/new-session-preferences';

describe('web new-session preferences', () => {
  beforeEach(() => localStorage.clear());

  it('stores model per agent and the last concrete chat scope', () => {
    rememberSelectedAgent('Coder');
    rememberAgentModel('Coder', { modelRef: 'openai/gpt-test', thinkingLevel: 'high' });
    rememberAgentModel('main', { modelRef: 'local/model' });
    rememberLastChatScope('project-1');

    expect(readNewSessionPreferences()).toMatchObject({
      selectedAgentId: 'coder',
      modelByAgent: {
        coder: { modelRef: 'openai/gpt-test', thinkingLevel: 'high' },
        main: { modelRef: 'local/model' },
      },
      lastChatScope: { kind: 'project', projectId: 'project-1' },
    });
  });

  it('falls back safely when storage is malformed', () => {
    localStorage.setItem('xopc.webchat.newSessionPreferences', '{bad json');
    expect(readNewSessionPreferences()).toMatchObject({
      version: 1,
      modelByAgent: {},
      lastChatScope: { kind: 'none' },
    });
  });
});
