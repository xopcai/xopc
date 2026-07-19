import { describe, expect, it } from 'vitest';

import { parseWorkflowSaveConflict, suggestAvailableWorkflowName } from '../workflow-save-utils';

describe('workflow save helpers', () => {
  it('suggests the first available suffixed name', () => {
    expect(suggestAvailableWorkflowName('review', ['review', 'review_2', 'review_4'])).toBe('review_3');
  });

  it('keeps an unused name unchanged', () => {
    expect(suggestAvailableWorkflowName('review', ['research'])).toBe('review');
  });

  it('parses a name conflict returned by the workflow API', () => {
    const cause = Object.assign(new Error('conflict'), {
      status: 409,
      body: {
        code: 'WORKFLOW_NAME_EXISTS',
        name: 'review',
        currentRevision: 1,
        suggestedName: 'review_2',
      },
    });
    expect(parseWorkflowSaveConflict(cause)).toEqual({
      code: 'WORKFLOW_NAME_EXISTS',
      name: 'review',
      currentRevision: 1,
      suggestedName: 'review_2',
    });
  });

  it('ignores unrelated API failures', () => {
    expect(parseWorkflowSaveConflict(Object.assign(new Error('bad request'), { status: 400 }))).toBeNull();
  });
});
