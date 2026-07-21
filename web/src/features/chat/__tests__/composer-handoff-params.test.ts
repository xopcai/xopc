import { describe, expect, it } from 'vitest';

import { buildComposerDraftSeed, searchParamsForComposerHandoff } from '@/features/chat/session/composer-handoff-params';

describe('composer handoff params', () => {
  it('combines a skill invocation with a supplied draft', () => {
    expect(buildComposerDraftSeed('build-xopc-local-app', 'Add a monthly view')).toBe(
      '/skill:build-xopc-local-app Add a monthly view',
    );
  });

  it('keeps the draft when the skill id is invalid', () => {
    expect(buildComposerDraftSeed('invalid skill', 'Keep this request')).toBe('Keep this request');
  });

  it('preserves both params while resolving a new chat route', () => {
    expect(searchParamsForComposerHandoff('?skill=build-xopc-local-app&draft=Add+filters&agent=coder'))
      .toBe('?skill=build-xopc-local-app&draft=Add+filters');
  });
});
