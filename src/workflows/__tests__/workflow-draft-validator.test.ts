import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDraftResponse,
  lintWorkflowDraft,
  parseGeneratedWorkflowDraft,
} from '../draft/workflow-draft-validator.js';

const graph = {
  schemaVersion: 1 as const,
  nodes: [
    { id: 'input', kind: 'input' as const, title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'inspect', kind: 'agent' as const, title: 'Inspect', position: { x: 300, y: 0 }, config: { prompt: 'Inspect {{input.goal}}', toolset: ['file_read'] } },
    { id: 'output', kind: 'output' as const, title: 'Output', position: { x: 600, y: 0 }, config: {} },
  ],
  edges: [{ id: 'a', source: 'input', target: 'inspect' }, { id: 'b', source: 'inspect', target: 'output' }],
};

describe('workflow draft validator', () => {
  it('parses fenced model JSON and normalizes the workflow name', () => {
    const draft = parseGeneratedWorkflowDraft(`\`\`\`json
{
  "name": "Weekly Audit!",
  "graph": ${JSON.stringify(graph)},
  "manifest": { "title": "Weekly Audit" },
  "explanation": "Checks weekly changes.",
  "assumptions": ["repo exists"],
  "risks": ["large repos take longer"]
}
\`\`\``);

    expect(draft.name).toBe('weekly_audit');
    expect(draft.manifest.title).toBe('Weekly Audit');
    expect(draft.assumptions).toEqual(['repo exists']);
  });

  it('builds a validated draft response', () => {
    const response = buildWorkflowDraftResponse({
      name: 'weekly_audit',
      graph,
      manifest: {
        title: 'Weekly Audit',
        inputSchema: { type: 'object', properties: { goal: { type: 'string', description: 'Scope' } } },
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      },
      explanation: '',
      assumptions: [],
      risks: [],
    });

    expect(response.validation.valid).toBe(true);
    expect(response.suggestedInputs?.[0]).toMatchObject({ key: 'goal', label: 'goal' });
  });

  it('warns when a draft violates constraints', () => {
    const issues = lintWorkflowDraft(
      {
        name: 'weekly_audit',
        graph,
        manifest: { permissions: { network: true, fileSystem: 'write' } },
        explanation: '',
        assumptions: [],
        risks: [],
      },
      { allowNetwork: false, fileSystem: 'read', allowedTools: ['web_search'], maxSubagents: 0 },
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsafe_permission', severity: 'error' }),
        expect.objectContaining({ code: 'unsafe_permission', severity: 'warning' }),
        expect.objectContaining({ code: 'unknown_tool' }),
      ]),
    );
  });
});
