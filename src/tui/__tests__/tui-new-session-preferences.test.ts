import { describe, expect, it } from 'vitest';

import {
  getTuiNewSessionPreferences,
  rememberTuiAgentModel,
  rememberTuiSessionContext,
  tuiInitialAgentConfig,
} from '../tui-new-session-preferences.js';
import { DEFAULT_TUI_SETTINGS } from '../tui-settings.js';

describe('TUI new-session preferences', () => {
  it('stores model per agent and context per gateway', () => {
    let settings = rememberTuiSessionContext(DEFAULT_TUI_SETTINGS, 'local', {
      agentId: 'Coder',
      projectId: 'project-1',
    });
    settings = rememberTuiAgentModel(settings, 'local', 'Coder', {
      modelRef: 'openai/gpt-test',
      thinkingLevel: 'high',
    });

    expect(getTuiNewSessionPreferences(settings, 'local')).toMatchObject({
      selectedAgentId: 'coder',
      lastChatScope: { kind: 'project', projectId: 'project-1' },
    });
    expect(tuiInitialAgentConfig(settings, 'local', 'coder')).toEqual({
      model: 'openai/gpt-test',
      thinkingLevel: 'high',
    });
    expect(tuiInitialAgentConfig(settings, 'https://remote.example', 'coder')).toBeUndefined();
  });
});
