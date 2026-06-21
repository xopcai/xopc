import { describe, expect, it } from 'vitest';

import {
  buildWorkflowDraftResponse,
  lintWorkflowDraft,
  parseGeneratedWorkflowDraft,
} from '../draft/workflow-draft-validator.js';

const script = `export const meta = {
  name: 'weekly_audit',
  description: 'Audit weekly changes.',
  phases: [{ title: 'Inspect' }, { title: 'Summarize' }],
  tags: ['audit'],
  estimatedAgents: { min: 2, max: 2 },
}

phase('Inspect')
const findings = await agent('Inspect ' + args.goal, { label: 'inspector', toolset: ['file_read'], maxIterations: 2 })
phase('Summarize')
return { summary: String(findings), sections: [{ kind: 'text', title: 'Summary', content: String(findings) }] }
`;

describe('workflow draft validator', () => {
  it('parses fenced model JSON and normalizes the workflow name', () => {
    const draft = parseGeneratedWorkflowDraft(`\`\`\`json
{
  "name": "Weekly Audit!",
  "script": ${JSON.stringify(script)},
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
      script,
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
        script,
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
