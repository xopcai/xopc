import { describe, expect, it } from 'vitest';
import type { ExecutionScope } from '../execution-scope.js';
import { formatCurrentWorkForPrompt } from '../execution-scope.js';

describe('formatCurrentWorkForPrompt', () => {
  it('keeps the current task contract visible on every turn', () => {
    const scope: ExecutionScope = {
      conversationId: "f611af3a-b8a3-4874-8f1c-f25a1f50df7c",
      projectId: 'project-1',
      objective: {
        kind: 'task',
        id: 'task-1',
        title: 'Ship project scope',
        objective: 'Keep every agent inside the project.',
        status: 'active',
        scopeBoundary: 'Do not modify unrelated UI.',
        acceptanceCriteria: ['Delegated children inherit the project.'],
        expectedOutputs: ['Targeted tests pass.'],
        nextAction: 'Implement the context resolver.',
      },
    };

    const prompt = formatCurrentWorkForPrompt(scope);
    expect(prompt).toContain('# Current Work');
    expect(prompt).toContain('Keep every agent inside the project.');
    expect(prompt).toContain('Do not modify unrelated UI.');
    expect(prompt).toContain('Delegated children inherit the project.');
    expect(prompt).toContain('Targeted tests pass.');
  });

  it('formats objectives without inventing task criteria', () => {
    const prompt = formatCurrentWorkForPrompt({
      conversationId: "5ffa4d86-8052-4d17-80ae-3b1ba46ec223",
      projectId: 'project-1',
      objective: {
        kind: 'task',
        id: 'run-1',
        title: 'research',
        objective: 'Map the project architecture.',
        status: 'active/running',
        acceptanceCriteria: [],
        expectedOutputs: [],
      },
    });

    expect(prompt).toContain('Type: task');
    expect(prompt).toContain('Map the project architecture.');
    expect(prompt).not.toContain('## Acceptance Criteria');
  });
});
