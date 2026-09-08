import { describe, expect, it } from 'vitest';

import {
  createDefaultNewSessionPreferences,
  executionModePreferenceForProject,
  modelPreferenceForAgent,
  newSessionCacheKey,
  parseNewSessionPreferences,
  resolveNewSessionSpec,
  withAgentModelPreference,
  withLastChatScope,
  withProjectExecutionModePreference,
  withSelectedAgent,
} from './new-session.js';

describe('new session contract', () => {
  it('resolves explicit project and explicit agent first', () => {
    expect(resolveNewSessionSpec({
      origin: 'project',
      project: { kind: 'project', projectId: ' project-a ' },
      agentId: ' Coder ',
      forceNew: true,
    }, {
      currentSession: { agentId: 'current', projectId: 'current-project' },
      projectDefaultAgentId: 'project-agent',
      selectedAgentId: 'selected',
      defaultAgentId: 'default',
      lastChatScope: { kind: 'project', projectId: 'last-project' },
    })).toEqual({
      origin: 'project',
      agentId: 'coder',
      projectId: 'project-a',
      forceNew: true,
      temporary: false,
    });
  });

  it('treats explicit no-project as stronger than current and remembered projects', () => {
    expect(resolveNewSessionSpec({
      origin: 'inbox',
      project: { kind: 'none' },
    }, {
      currentSession: { agentId: 'current', projectId: 'current-project' },
      defaultAgentId: 'main',
      lastChatScope: { kind: 'project', projectId: 'last-project' },
    }).projectId).toBeNull();
  });

  it('inherits both project and agent from the current session', () => {
    expect(resolveNewSessionSpec({
      origin: 'chat-header',
      project: { kind: 'inherit-current' },
    }, {
      currentSession: { agentId: 'Research', projectId: 'project-a' },
      projectDefaultAgentId: 'project-agent',
      selectedAgentId: 'selected',
      defaultAgentId: 'main',
    })).toMatchObject({ agentId: 'research', projectId: 'project-a' });
  });

  it('uses the project default before selected and global agent defaults', () => {
    expect(resolveNewSessionSpec({
      origin: 'project',
      project: { kind: 'project', projectId: 'project-a' },
    }, {
      projectDefaultAgentId: 'project-agent',
      selectedAgentId: 'selected',
      defaultAgentId: 'main',
    }).agentId).toBe('project-agent');
  });

  it('uses the remembered project only for remember-last intent', () => {
    expect(resolveNewSessionSpec({
      origin: 'global',
      project: { kind: 'remember-last' },
    }, {
      defaultAgentId: 'main',
      lastChatScope: { kind: 'project', projectId: 'project-a' },
    }).projectId).toBe('project-a');
  });

  it('falls back to no project and main agent', () => {
    expect(resolveNewSessionSpec({
      origin: 'global',
      project: { kind: 'remember-last' },
    }, {
      defaultAgentId: '',
    })).toMatchObject({ agentId: 'main', projectId: null });
  });

  it('stores model preferences per normalized agent', () => {
    let preferences = createDefaultNewSessionPreferences();
    preferences = withAgentModelPreference(preferences, ' Coder ', {
      modelRef: ' openai/gpt-test ',
      thinkingLevel: ' high ',
    });
    preferences = withAgentModelPreference(preferences, 'Research', {
      modelRef: 'anthropic/claude-test',
    });
    expect(modelPreferenceForAgent(preferences, 'coder')).toMatchObject({
      modelRef: 'openai/gpt-test',
      thinkingLevel: 'high',
    });
    expect(modelPreferenceForAgent(preferences, 'research')?.modelRef).toBe('anthropic/claude-test');
  });

  it('removes an agent model preference without affecting other agents', () => {
    let preferences = createDefaultNewSessionPreferences();
    preferences = withAgentModelPreference(preferences, 'coder', { modelRef: 'p/a' });
    preferences = withAgentModelPreference(preferences, 'research', { modelRef: 'p/b' });
    preferences = withAgentModelPreference(preferences, 'coder', null);
    expect(preferences.modelByAgent).toEqual({ research: { modelRef: 'p/b' } });
  });

  it('stores execution mode preferences per normalized project', () => {
    let preferences = createDefaultNewSessionPreferences();
    expect(executionModePreferenceForProject(preferences, 'project-a')).toBeUndefined();
    preferences = withProjectExecutionModePreference(preferences, ' project-a ', 'managed_worktree');
    preferences = withProjectExecutionModePreference(preferences, 'project-b', 'local_checkout');
    expect(executionModePreferenceForProject(preferences, 'project-a')).toBe('managed_worktree');
    expect(executionModePreferenceForProject(preferences, ' project-b ')).toBe('local_checkout');
    preferences = withProjectExecutionModePreference(preferences, 'project-a', null);
    expect(executionModePreferenceForProject(preferences, 'project-a')).toBeUndefined();
  });

  it('records project and no-project scopes without ambiguity', () => {
    let preferences = createDefaultNewSessionPreferences();
    preferences = withLastChatScope(preferences, ' project-a ');
    expect(preferences.lastChatScope).toEqual({ kind: 'project', projectId: 'project-a' });
    preferences = withLastChatScope(preferences, null);
    expect(preferences.lastChatScope).toEqual({ kind: 'none' });
  });

  it('normalizes selected agent without retaining a cleared value', () => {
    let preferences = withSelectedAgent(createDefaultNewSessionPreferences(), ' Coder ');
    expect(preferences.selectedAgentId).toBe('coder');
    preferences = withSelectedAgent(preferences, null);
    expect(preferences).not.toHaveProperty('selectedAgentId');
  });

  it('parses only the current version and valid preferences', () => {
    expect(parseNewSessionPreferences({
      version: 1,
      selectedAgentId: ' Coder ',
      modelByAgent: {
        Coder: { modelRef: ' p/a ', thinkingLevel: ' high ' },
        invalid: { modelRef: '' },
      },
      executionModeByProject: {
        ' p1 ': 'managed_worktree',
        invalid: 'remote',
      },
      lastChatScope: { kind: 'project', projectId: ' p1 ' },
    })).toEqual({
      version: 1,
      selectedAgentId: 'coder',
      modelByAgent: { coder: { modelRef: 'p/a', thinkingLevel: 'high' } },
      executionModeByProject: { p1: 'managed_worktree' },
      lastChatScope: { kind: 'project', projectId: 'p1' },
    });
    expect(parseNewSessionPreferences({ version: 0 }).lastChatScope).toEqual({ kind: 'none' });
  });

  it('keys reusable sessions by gateway, agent, and project scope', () => {
    expect(newSessionCacheKey('gateway-a', { agentId: 'Coder', projectId: 'project-a' }))
      .toBe('gateway-a:coder:project-a');
    expect(newSessionCacheKey('gateway-a', { agentId: 'Coder', projectId: null }))
      .toBe('gateway-a:coder:none');
  });
});
