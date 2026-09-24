import type { WorkflowDefinitionManifest, WorkflowGraph } from '../domain/definition.js';

export function createStarterWorkflowGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'input', kind: 'input', title: 'Input', description: 'What the user provides', position: { x: 0, y: 120 }, config: {} },
      {
        id: 'agent-1', kind: 'agent', title: 'Do the work', description: 'Understand and complete the request',
        phaseId: 'work', position: { x: 300, y: 120 },
        config: { prompt: 'Complete this goal: {{goal}}\n\nUser input:\n{{input}}', maxIterations: 12 },
      },
      { id: 'output', kind: 'output', title: 'Result', description: 'A clear answer for the user', position: { x: 620, y: 120 }, config: {} },
    ],
    edges: [
      { id: 'input-agent', source: 'input', target: 'agent-1' },
      { id: 'agent-output', source: 'agent-1', target: 'output' },
    ],
  };
}

export function createStarterWorkflowManifest(title = 'Untitled workflow'): WorkflowDefinitionManifest {
  return { title, description: '', tags: ['custom'] };
}
