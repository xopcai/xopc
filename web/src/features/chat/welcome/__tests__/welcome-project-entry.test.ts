import { describe, expect, it } from 'vitest';

import { resolveWelcomeProjectEntryMode } from '../welcome-project-entry';

const discovery = (
  status: 'not_started' | 'in_progress' | 'completed' | 'dismissed',
  activeRunId?: string,
) => ({ enabled: true, state: { status, activeRunId } });

describe('resolveWelcomeProjectEntryMode', () => {
  it.each(['codingProject', 'generalProject', 'workingDirectory', 'note'])(
    'hides the entry for %s context',
    (contextKind) => {
      expect(
        resolveWelcomeProjectEntryMode({
          contextKind,
          projectCount: 2,
          workDiscovery: discovery('not_started'),
        }),
      ).toBe('hidden');
    },
  );

  it('offers existing projects before folder discovery', () => {
    expect(
      resolveWelcomeProjectEntryMode({
        contextKind: 'empty',
        projectCount: 2,
        workDiscovery: discovery('not_started'),
      }),
    ).toBe('choose_project');
  });

  it('offers folder discovery to a new user without projects', () => {
    expect(
      resolveWelcomeProjectEntryMode({
        contextKind: 'empty',
        projectCount: 0,
        workDiscovery: discovery('not_started'),
      }),
    ).toBe('discover_folder');
  });

  it('resumes an active discovery run', () => {
    expect(
      resolveWelcomeProjectEntryMode({
        contextKind: 'empty',
        projectCount: 0,
        workDiscovery: discovery('in_progress', 'run-1'),
      }),
    ).toBe('resume_discovery');
  });

  it.each(['completed', 'dismissed'] as const)('does not repeat after %s', (status) => {
    expect(
      resolveWelcomeProjectEntryMode({
        contextKind: 'empty',
        projectCount: 0,
        workDiscovery: discovery(status),
      }),
    ).toBe('hidden');
  });
});
