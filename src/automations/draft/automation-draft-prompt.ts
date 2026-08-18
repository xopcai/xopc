export interface AutomationDraftRepairIssue {
  source: 'parse' | 'validation';
  severity: 'error';
  message: string;
}

export function buildAutomationDraftPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
}): string {
  return `You generate xopc automation drafts. Return ONLY a JSON object, no markdown.

JSON shape:
{
  "automation": {
    "name": "Short human name",
    "description": "What this automation does",
    "trigger": { "kind": "manual" },
    "action": { "kind": "agent", "instruction": "clear instruction for the agent" },
    "safety": { "mode": "suggest_only" },
    "afterRun": { "kind": "none" },
    "reliability": { "timeoutSeconds": 300, "disableAfterConsecutiveFailures": 3 }
  },
  "explanation": "Short explanation",
  "assumptions": ["..."],
  "risks": ["..."]
}

Allowed triggers:
- Manual: { "kind": "manual" }
- Schedule interval: { "kind": "schedule", "schedule": { "kind": "interval", "everyMs": 3600000 } }
- Schedule cron: { "kind": "schedule", "schedule": { "kind": "cron", "expr": "0 9 * * *" } }
- Webhook: { "kind": "webhook", "secretId": "optional-short-id" }
- Product event: { "kind": "event", "eventType": "outcome.status_changed", "source": "outcomes", "payloadMatch": { "status": "blocked" } }

Useful product events:
- session.message.created
- session.transcript.updated
- note.created
- note.updated
- outcome.created
- outcome.status_changed
- workflow.run.completed
- channel.message.received

Allowed actions:
- Agent: { "kind": "agent", "agentId": "optional", "instruction": "what to do", "timeoutSeconds": 300 }
- Workflow: { "kind": "workflow", "workflowId": "known_workflow_id", "input": {}, "goal": "optional", "timeoutSeconds": 300 }

Safety modes:
- { "mode": "suggest_only" }: safest default, generate recommendations only.
- { "mode": "ask_before_apply" }: draft actions and require user confirmation before applying.
- { "mode": "auto_apply" }: trusted automation may act automatically.

Rules:
- Prefer agent actions unless the user names a specific existing workflow id.
- Default to safety { "mode": "suggest_only" } unless the user explicitly asks for fully automatic execution.
- Do not invent destructive actions. For deletion, external sending, or irreversible changes, include a risk and make the instruction ask for confirmation.
- Use cron for daily/weekly schedules. Use standard 5-field cron.
- Keep timeoutSeconds between 60 and 1800.
- afterRun should usually be { "kind": "none" }.
- Language for user-facing copy: ${params.language ?? 'en'}.

User request:
${params.prompt.slice(0, 8000)}
`;
}

export function buildAutomationDraftRepairPrompt(params: {
  prompt: string;
  language?: 'en' | 'zh';
  previousOutput: string;
  issues: AutomationDraftRepairIssue[];
}): string {
  return `Repair the xopc automation draft. Return ONLY a JSON object with the same shape.

Original user request:
${params.prompt.slice(0, 8000)}

Language for user-facing copy: ${params.language ?? 'en'}

Previous output:
${params.previousOutput.slice(0, 12000)}

Issues:
${params.issues.map((issue) => `- ${issue.source}: ${issue.message}`).join('\n')}
`;
}

export function buildAutomationRunRepairPrompt(params: {
  language?: 'en' | 'zh';
  automation: unknown;
  run: unknown;
  events: unknown[];
}): string {
  return `You suggest safe repair patches for xopc automations. Return ONLY a JSON object, no markdown.

JSON shape:
{
  "patch": {
    "description": "optional improved description",
    "trigger": "optional complete trigger object",
    "action": "optional complete action object",
    "safety": "optional complete safety object",
    "afterRun": "optional complete afterRun object",
    "reliability": "optional complete reliability object",
    "enabled": true
  },
  "explanation": "Why this patch should fix the failed run",
  "expectedEffect": "What changes after applying it",
  "risks": ["..."],
  "requiresApproval": true
}

Rules:
- Return a PATCH only. Do not include id, state, createdAtMs, or updatedAtMs.
- Keep the patch minimal. Prefer reliability/action/input fixes over broad rewrites.
- If the failure is unclear, propose only a safer timeout/retry/description patch and explain uncertainty.
- Never add destructive or external behavior. If the existing automation has risky external behavior, keep requiresApproval true.
- Language for user-facing copy: ${params.language ?? 'en'}.

Current automation:
${JSON.stringify(params.automation, null, 2).slice(0, 12000)}

Failed run:
${JSON.stringify(params.run, null, 2).slice(0, 8000)}

Timeline events:
${JSON.stringify(params.events, null, 2).slice(0, 12000)}
`;
}

export function buildAutomationRunRepairRetryPrompt(params: {
  language?: 'en' | 'zh';
  previousOutput: string;
  issues: AutomationDraftRepairIssue[];
}): string {
  return `Repair the automation repair patch. Return ONLY a JSON object with the same shape.

Language for user-facing copy: ${params.language ?? 'en'}

Previous output:
${params.previousOutput.slice(0, 12000)}

Issues:
${params.issues.map((issue) => `- ${issue.source}: ${issue.message}`).join('\n')}
`;
}
