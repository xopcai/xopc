import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '../../connectors/types.js';
import { buildTaskSourceRecommendations } from '../source-recommendations.js';

function source(id: string, displayName: string, description: string): ConnectorDefinition {
  return {
    id,
    version: '1',
    displayName,
    description,
    category: 'data',
    kind: 'memorySource',
    source: 'builtin',
    capabilities: ['context'],
    auth: { mode: 'none' },
    setup: {},
    runtime: { type: 'memorySource', sourceKind: id },
  };
}

describe('task source recommendations', () => {
  it('matches Chinese task intent to an available source and excludes installed sources', () => {
    const definitions = [
      source('calendar', 'Calendar', 'Meetings, schedules, and events'),
      source('mail', 'Email', 'Mail and inbox context'),
    ];
    const tasks = [{ id: 'task-1', objective: '安排下周的客户会议' }];

    expect(buildTaskSourceRecommendations(definitions, new Set(), tasks)).toMatchObject([
      { sourceId: 'calendar', taskId: 'task-1' },
    ]);
    expect(buildTaskSourceRecommendations(definitions, new Set(['calendar']), tasks)).toEqual([]);
  });
});
