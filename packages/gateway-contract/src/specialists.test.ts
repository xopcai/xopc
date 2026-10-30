import { expect, it } from 'vitest';

import { normalizeSpecialistRequirements } from './specialists.js';

it('normalizes persisted discovery requirements without mutating installed task data', () => {
  const saved = { version: 1, summary: 'Read connected mail', requiredTools: [
    'xopc_tool_search', 'tool_search', 'xopc_tool_describe', 'xopc_tool_execute',
  ], requiredSkills: ['xopc_tool_search'] };
  const normalized = normalizeSpecialistRequirements(JSON.parse(JSON.stringify(saved)));
  expect(normalized.requiredTools).toEqual(['tool_search', 'xopc_tool_describe', 'xopc_tool_execute']);
  expect(normalized.requiredSkills).toEqual(['xopc_tool_search']);
  expect(saved.requiredTools[0]).toBe('xopc_tool_search');
  expect(normalizeSpecialistRequirements(normalized)).toEqual(normalized);
});
