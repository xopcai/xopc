import type { WorkflowGraph } from '../domain/definition.js';
import type { WorkflowDraftConstraints, WorkflowDraftMode } from './workflow-draft.types.js';

export interface WorkflowDraftRepairIssue {
  source: 'parse' | 'validation' | 'lint';
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export function buildWorkflowDraftPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
  mode: WorkflowDraftMode;
  existingGraph?: WorkflowGraph;
  constraints?: WorkflowDraftConstraints;
}): string {
  return `${GRAPH_DESIGN_PROMPT}

Mode: ${params.mode}
Language for user-facing copy: ${params.language ?? 'en'}
Constraints:
${JSON.stringify(params.constraints ?? {}, null, 2)}

${params.existingGraph ? `Existing graph to improve:\n${JSON.stringify(params.existingGraph, null, 2).slice(0, 16000)}\n` : ''}
User request:
${params.prompt.slice(0, 8000)}`;
}

export function buildWorkflowDraftRepairPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
  constraints?: WorkflowDraftConstraints;
  previousOutput: string;
  issues: WorkflowDraftRepairIssue[];
}): string {
  return `${GRAPH_DESIGN_PROMPT}

Repair the previous graph while preserving the user's intent. Fix every listed issue.
Language for user-facing copy: ${params.language ?? 'en'}
Constraints:
${JSON.stringify(params.constraints ?? {}, null, 2)}
Issues:
${JSON.stringify(params.issues, null, 2)}
User request:
${params.prompt.slice(0, 8000)}
Previous output:
${params.previousOutput.slice(0, 16000)}`;
}

const GRAPH_DESIGN_PROMPT = `You design xopc visual workflows for non-technical users. Return ONLY one JSON object, no markdown.

Shape:
{
  "name": "lowercase_snake_case",
  "graph": { "schemaVersion": 1, "nodes": [], "edges": [] },
  "manifest": {
    "title": "Human title", "description": "Task in plain language", "version": "1.0.0",
    "inputSchema": { "type": "object", "properties": {}, "required": [] },
    "defaults": { "concurrency": 3, "timeoutSec": 1800, "maxSubagents": 8 },
    "permissions": { "network": false, "fileSystem": "read", "approvalRequired": false },
    "tags": ["custom"], "whenToUse": "A concrete user situation"
  },
  "explanation": "Short explanation", "assumptions": [], "risks": []
}

Graph rules:
- Exactly one input node and one output node. Every node must be reachable from input and lead toward output.
- Node kinds are input, agent, decision, merge, output.
- Every node has id, kind, title, position {x,y}, config, and optional phaseId/description.
- input config: {schema?}; agent config: {prompt, model?, toolset?, maxIterations?, outputSchema?}; decision config: {rule:{path,operator,value?}}; merge config: {mode:"array"|"object"}; output config: {summary?,title?}.
- Edge shape: {id,source,target,sourcePort?}. Decision branch ports are true and false.
- Agent prompts may reference {{goal}}, {{input}}, {{input.field}}, {{nodes.nodeId}}, and {{predecessors.nodeId}}.
- Prefer a small, understandable graph: 3-8 nodes, short titles, clear descriptions. Parallel independent work should fan out and then merge.
- Do not create code or script fields. Do not request permissions the user did not need.`;
