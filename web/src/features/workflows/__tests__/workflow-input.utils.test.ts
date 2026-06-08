import { describe, expect, it } from 'vitest';

import {
  validateWorkflowArgValues,
  workflowInputToArgValues,
} from '@/features/workflows/workflow-input.utils';

describe('workflowInputToArgValues', () => {
  it('maps payload keys to arg field values', () => {
    expect(
      workflowInputToArgValues('weekly_review', {
        wins: 'Shipped v1',
        blockers: 'Pricing',
        extra: 'ignored',
      }),
    ).toEqual({
      wins: 'Shipped v1',
      blockers: 'Pricing',
    });
  });

  it('returns empty object when workflow has no arg fields', () => {
    expect(workflowInputToArgValues('audit_repo', { foo: 'bar' })).toEqual({});
  });
});

describe('validateWorkflowArgValues', () => {
  it('requires configured required fields', () => {
    expect(validateWorkflowArgValues('weekly_review', { wins: 'ok' })).toBe(true);
    expect(validateWorkflowArgValues('weekly_review', { blockers: 'only blockers' })).toBe(false);
    expect(validateWorkflowArgValues('weekly_review', {})).toBe(false);
  });

  it('passes when workflow has no arg schema', () => {
    expect(validateWorkflowArgValues('audit_repo', {})).toBe(true);
  });
});
