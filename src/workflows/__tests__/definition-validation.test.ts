import { describe, expect, it } from 'vitest';

import { validateWorkflowDefinitionInput } from '../domain/validation.js';

const validScript = `export const meta = {
  name: 'demo_workflow',
  description: 'Demo workflow',
  whenToUse: 'When validating workflow definitions.',
  phases: [{ title: 'Collect' }, { title: 'Synthesize', detail: 'Merge findings' }],
  tags: ['custom'],
  estimatedAgents: { min: 2, max: 4 },
}

phase('Collect')
const first = await agent('Collect context', { label: 'collect' })

phase('Synthesize')
return await agent('Summarize:\\n\\n' + first, { label: 'synthesis' })
`;

describe('validateWorkflowDefinitionInput', () => {
  it('returns a definition preview for a valid workflow script', () => {
    const result = validateWorkflowDefinitionInput({
      name: 'demo_workflow',
      script: validScript,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.definition?.name).toBe('demo_workflow');
    expect(result.definition?.phases.map((phase) => phase.title)).toEqual(['Collect', 'Synthesize']);
    expect(result.definition?.defaults.maxSubagents).toBe(4);
    expect(result.definition?.metadata.source).toBe('user');
  });

  it('rejects an empty name', () => {
    const result = validateWorkflowDefinitionInput({ name: '', script: validScript });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('name_required');
  });

  it('rejects an empty script', () => {
    const result = validateWorkflowDefinitionInput({ name: 'demo_workflow', script: '' });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('script_required');
  });

  it('rejects malformed workflow script', () => {
    const result = validateWorkflowDefinitionInput({
      name: 'demo_workflow',
      script: 'export const meta = ',
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('parse_failed');
    expect(result.errors[0]?.message).toContain('Workflow script parse error');
  });

  it('rejects meta name mismatch', () => {
    const result = validateWorkflowDefinitionInput({
      name: 'other_workflow',
      script: validScript,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('meta_name_mismatch');
  });

  it('rejects invalid workflow names before parsing', () => {
    const result = validateWorkflowDefinitionInput({
      name: 'DemoWorkflow',
      script: validScript,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('parse_failed');
    expect(result.errors[0]?.message).toContain('lowercase snake_case');
  });
});
