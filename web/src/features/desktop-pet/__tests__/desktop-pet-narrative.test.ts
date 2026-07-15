import { describe, expect, it } from 'vitest';

import {
  desktopPetActionForPhase,
  progressNarrative,
  toolNarrative,
  type DesktopPetNarrativeLabels,
} from '../desktop-pet-narrative';
import { mapAgentStreamEvent } from '../desktop-pet-event-bridge';
import { activityCompletionText, activityDetailText, activityHealthText, shouldShowIdleTip } from '../desktop-pet-root';

const labels: DesktopPetNarrativeLabels = {
  searchedWeb: 'searching the web',
  readFile: 'reading files',
  runCommand: 'running a command',
  updatePlan: 'updating the plan',
  listDirectory: 'checking a directory',
  writeFile: 'writing files',
  editFile: 'editing files',
  openUrl: 'opening a link',
  fetchUrl: 'reading a web page',
  unknownTool: 'using {{name}}',
  tipRunStart: 'I am lining up the context and getting started.',
  tipTool: 'I am {{action}}{{detail}}.',
  tipProgress: 'I am still moving this forward{{progress}}.',
  tipValidate: 'I am checking the last step{{progress}}.',
  tipWaiting: 'This needs your call.',
  tipAssistantDelta: 'I am shaping the answer.',
  tipCommandDelta: 'The command has new output.',
  tipAssistantDone: 'I have the main points and am wrapping up.',
  tipComplete: 'Done. The result is back in this chat.',
  tipError: 'This step needs attention.',
  targetSuffix: ': {{detail}}',
  progressSuffix: ' · {{completed}}/{{total}}',
};

describe('desktop pet narrative', () => {
  it('maps work phases to the matching pet animation', () => {
    expect(desktopPetActionForPhase('researching')).toBe('search');
    expect(desktopPetActionForPhase('reading')).toBe('file');
    expect(desktopPetActionForPhase('editing')).toBe('file');
    expect(desktopPetActionForPhase('browsing')).toBe('browser');
    expect(desktopPetActionForPhase('running', 'exec_command')).toBe('terminal');
  });

  it('builds concise tool tips with safe target context', () => {
    expect(toolNarrative(labels, 'read_file', 'reading', 'service.ts')).toMatchObject({
      action: 'I am reading files: service.ts.',
      animation: 'file',
      priority: 'normal',
    });
  });

  it('adds progress only when counts are available', () => {
    expect(progressNarrative(labels, 'running', 2, 5).action).toBe('I am checking the last step · 2/5.');
    expect(progressNarrative(labels, 'planning').action).toBe('I am still moving this forward.');
  });

  it('turns stream events into prioritized pet updates', () => {
    const update = mapAgentStreamEvent(
      {
        sessionKey: 'agent:main:webchat:test',
        event: { type: 'command_output_delta', payload: { delta: 'pnpm test passed' } },
      },
      1,
      'Fix tests',
      labels,
    );

    expect(update).toMatchObject({
      sessionKey: 'agent:main:webchat:test',
      sessionLabel: 'Fix tests',
      state: 'running',
      phase: 'running',
      animation: 'terminal',
      priority: 'low',
      action: 'The command has new output.',
      outputTail: 'pnpm test passed',
    });
  });

  it('does not append progress counts when the tip already contains them', () => {
    expect(
      activityDetailText(
        {
          sessionKey: 'agent:main:webchat:test',
          runId: 'active',
          sessionLabel: 'Fix tests',
          sequence: 1,
          timestamp: 1_000,
          state: 'running',
          phase: 'running',
          action: 'I am checking the last step · 2/5.',
          progress: { completed: 2, total: 5 },
        },
        2_000,
        ': {{detail}}',
      ),
    ).toBe('');
  });

  it('surfaces long-running and stale task health', () => {
    const base = {
      sessionKey: 'agent:main:webchat:test',
      runId: 'active',
      sessionLabel: 'Fix tests',
      sequence: 1,
      state: 'running' as const,
      phase: 'running' as const,
      action: 'I am shaping the answer.',
    };

    expect(
      activityHealthText(
        { ...base, timestamp: 90_000, startedAt: 0 },
        91_000,
        { longRunning: 'running long', stale: 'stale' },
      ),
    ).toBe('running long');

    expect(
      activityHealthText(
        { ...base, timestamp: 60_000, startedAt: 0 },
        91_000,
        { longRunning: 'running long', stale: 'stale' },
      ),
    ).toBe('stale');
  });

  it('builds a compact completion summary from the latest output line', () => {
    expect(
      activityCompletionText(
        {
          sessionKey: 'agent:main:webchat:test',
          runId: 'active',
          sessionLabel: 'Fix tests',
          sequence: 1,
          timestamp: 1_000,
          state: 'success',
          phase: 'running',
          action: 'Done. The result is back in this chat.',
          outputLines: ['Edited two files', 'Tests passed'],
        },
        'Done: {{summary}}',
      ),
    ).toBe('Done: Tests passed');
  });

  it('shows idle companionship only in the quiet window between tasks', () => {
    const base = {
      bubbleEnabled: true,
      feedbackLevel: 'normal' as const,
      collapsed: false,
      queuedCount: 0,
      activeCount: 0,
      dismissedUntil: 0,
    };

    expect(shouldShowIdleTip({ ...base, now: 20 * 60_000, lastActivityAt: 0 })).toBe(true);
    expect(shouldShowIdleTip({ ...base, feedbackLevel: 'quiet', now: 20 * 60_000, lastActivityAt: 0 })).toBe(false);
    expect(shouldShowIdleTip({ ...base, activeCount: 1, now: 20 * 60_000, lastActivityAt: 0 })).toBe(false);
    expect(shouldShowIdleTip({ ...base, now: 21 * 60_000, lastActivityAt: 0 })).toBe(false);
  });
});
