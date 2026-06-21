import type { WorkflowDraftConstraints, WorkflowDraftMode } from './workflow-draft.types.js';

export interface WorkflowDraftRepairIssue {
  source: 'parse' | 'validation' | 'lint';
  severity: 'error' | 'warning';
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export function buildWorkflowDraftPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
  mode: WorkflowDraftMode;
  existingScript?: string;
  constraints?: WorkflowDraftConstraints;
}): string {
  return `You generate xopc workflow drafts. Return ONLY a JSON object, no markdown.

JSON shape:
{
  "name": "lowercase_snake_case",
  "script": "workflow JavaScript DSL",
  "manifest": {
    "title": "Human title",
    "description": "What it does",
    "version": "1.0.0",
    "inputSchema": { "type": "object", "properties": {}, "required": [] },
    "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" } }, "required": ["summary"] },
    "defaults": { "concurrency": 2, "timeoutSec": 1800, "maxSubagents": 8 },
    "permissions": { "network": false, "fileSystem": "read", "approvalRequired": false },
    "tags": ["custom"],
    "whenToUse": "When to use this workflow"
  },
  "explanation": "Short explanation",
  "assumptions": ["..."],
  "risks": ["..."]
}

DSL rules:
- script MUST start with: export const meta = { name, description, phases, tags, estimatedAgents }
- The top-level JSON "name" MUST exactly equal script meta.name.
- Use only these globals: phase(title), agent(prompt, opts), parallel([() => agent(...)]), pipeline(items, ...stages), log(message), budget, args.
- Read user inputs from args, e.g. args.goal, args.branch, args.audience.
- Each agent needs a clear label.
- Keep concurrency conservative; prefer 2-4.
- Return a WorkflowResultEnvelope-like object: { summary, sections, followUps?, structuredOutput? }.
- Do not use import, require, eval, Function, process.env, fs, http, fetch.
- If network/write/destructive behavior is requested, mark manifest.permissions.approvalRequired = true.
- Keep script self-contained and valid JavaScript.

Mode: ${params.mode}
Language for user-facing copy: ${params.language ?? 'en'}
Constraints:
${JSON.stringify(params.constraints ?? {}, null, 2)}

${params.existingScript ? `Existing script to improve:\n${params.existingScript.slice(0, 12000)}\n` : ''}

User request:
${params.prompt.slice(0, 8000)}
`;
}

export function buildWorkflowDraftRepairPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
  constraints?: WorkflowDraftConstraints;
  previousOutput: string;
  issues: WorkflowDraftRepairIssue[];
}): string {
  return `You must repair an xopc workflow draft so it passes validation. Return ONLY a corrected JSON object, no markdown.

Required JSON shape is unchanged:
{
  "name": "lowercase_snake_case",
  "script": "workflow JavaScript DSL",
  "manifest": {
    "title": "Human title",
    "description": "What it does",
    "version": "1.0.0",
    "inputSchema": { "type": "object", "properties": {}, "required": [] },
    "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" } }, "required": ["summary"] },
    "defaults": { "concurrency": 2, "timeoutSec": 1800, "maxSubagents": 8 },
    "permissions": { "network": false, "fileSystem": "read", "approvalRequired": false },
    "tags": ["custom"],
    "whenToUse": "When to use this workflow"
  },
  "explanation": "Short explanation",
  "assumptions": ["..."],
  "risks": ["..."]
}

Hard requirements:
- The output MUST be valid JSON.
- JSON name MUST be lowercase snake_case and MUST exactly equal script meta.name.
- script MUST be valid JavaScript for the xopc workflow DSL.
- script MUST start with export const meta = { ... } and include phases, tags, estimatedAgents.
- Use only these globals: phase(title), agent(prompt, opts), parallel([() => agent(...)]), pipeline(items, ...stages), log(message), budget, args.
- Do not use import, require, eval, Function, process.env, fs, http, fetch.
- Respect the constraints exactly. If network is disabled, manifest.permissions.network must be false.
- Preserve the user's intent while making the smallest change needed to pass validation.

Language for user-facing copy: ${params.language ?? 'en'}
Constraints:
${JSON.stringify(params.constraints ?? {}, null, 2)}

Validation and lint issues to fix:
${JSON.stringify(params.issues, null, 2)}

Original user request:
${params.prompt.slice(0, 8000)}

Previous model output:
${params.previousOutput.slice(0, 12000)}
`;
}
