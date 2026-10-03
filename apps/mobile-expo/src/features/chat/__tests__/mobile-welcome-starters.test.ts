import { describe, expect, it } from 'vitest';

import { en } from '../../../i18n/locales/en';
import { buildMobileWelcomeModel } from '../mobile-welcome-starters';

describe('buildMobileWelcomeModel', () => {
  it('keeps an unscoped chat quiet', () => {
    const model = buildMobileWelcomeModel({ messages: en });

    expect(model.headline).toBe('What do you want to move forward?');
    expect(model.starters).toEqual([]);
  });

  it('does not infer an action from project identity alone', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      project: { id: 'project-1', name: 'xopc' } as never,
    });

    expect(model.starters).toEqual([]);
  });

  it('shows one task recommendation when attention is explicit', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      task: {
        task: { id: 'task-1', title: 'Ship release', phase: 'active' },
        operationalState: 'waiting',
        attention: [{ summary: 'Approve the release date' }],
        receipts: [],
      } as never,
    });

    expect(model.starters).toHaveLength(1);
    expect(model.starters[0]?.title).toContain('Approve the release date');
    expect(model.starters[0]?.prompt).toContain('Approve the release date');
  });

  it('uses the highest-priority explicit project signal', () => {
    const model = buildMobileWelcomeModel({
      messages: en,
      project: { id: 'project-1', name: 'Launch' } as never,
      projectOperating: {
        blockers: [{ title: 'Legal review' }],
        recentResults: [],
        digest: { health: 'attention', summary: 'Blocked', recommendedAction: 'Get approval' },
      } as never,
    });

    expect(model.starters).toHaveLength(1);
    expect(model.starters[0]?.id).toBe('project-blocked');
    expect(model.starters[0]?.prompt).toContain('Legal review');
  });
});
