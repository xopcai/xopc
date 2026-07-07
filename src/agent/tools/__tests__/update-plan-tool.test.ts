import { describe, expect, it } from 'vitest';

import { createUpdatePlanTool } from '../update-plan-tool.js';

describe('update_plan tool', () => {
  it('returns normalized plan details', async () => {
    const tool = createUpdatePlanTool();
    const result = await tool.execute('plan-1', {
      explanation: '  implementing P0  ',
      plan: [
        { step: 'Inspect current code', status: 'completed' },
        { step: 'Wire protocol event', status: 'in_progress' },
        { step: 'Run tests', status: 'pending' },
      ],
    });

    expect(result.details).toEqual({
      explanation: 'implementing P0',
      plan: [
        { step: 'Inspect current code', status: 'completed' },
        { step: 'Wire protocol event', status: 'in_progress' },
        { step: 'Run tests', status: 'pending' },
      ],
    });
    expect((result.content[0] as { text: string }).text).toContain('[in_progress] Wire protocol event');
  });

  it('rejects multiple in-progress steps', async () => {
    const tool = createUpdatePlanTool();
    await expect(
      tool.execute('plan-2', {
        plan: [
          { step: 'A', status: 'in_progress' },
          { step: 'B', status: 'in_progress' },
        ],
      }),
    ).rejects.toThrow('at most one plan item');
  });

  it('rejects empty steps and invalid statuses', async () => {
    const tool = createUpdatePlanTool();
    await expect(tool.execute('plan-3', { plan: [{ step: ' ', status: 'pending' }] })).rejects.toThrow(
      'non-empty step',
    );
    await expect(tool.execute('plan-4', { plan: [{ step: 'A', status: 'active' }] })).rejects.toThrow(
      'invalid plan status',
    );
  });
});
