import { describe, expect, it } from 'vitest';

import { reliabilityTasks, runReliabilityTask } from '../../../scripts/phone-reliability/tasks.js';

describe('phone task-level reliability with simulated device', () => {
  for (const task of reliabilityTasks) it(task.id, async () => {
    const result = await runReliabilityTask(task);
    expect(result, JSON.stringify(result)).toMatchObject({ passed: true });
  });
});
