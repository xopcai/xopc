import { NO_REPLY } from '../../heartbeat/tokens.js';
import { buildSystemPrompt } from './system-prompt.js';

export function buildSubagentContextSection(params: {
  goal: string;
  context?: string;
  workspace?: string;
  requesterSessionKey?: string;
  childSessionKey?: string;
}): string {
  const taskBody = params.goal.trim();
  const roleLines =
    taskBody.includes('\n')
      ? [
          '## Your Role',
          '- You were created to handle the following task (verbatim; line breaks preserved):',
          '',
          '```',
          taskBody,
          '```',
          "- Complete this task. That's your entire purpose.",
          '- You are NOT the parent agent. Don\'t try to be.',
        ]
      : [
          '## Your Role',
          `- You were created to handle: ${taskBody}`,
          "- Complete this task. That's your entire purpose.",
          '- You are NOT the parent agent. Don\'t try to be.',
        ];

  const lines = [
    '# Subagent Context',
    '',
    'You are a **sub-agent** spawned by the parent agent for a specific task.',
    '',
    ...roleLines,
    '',
    '## Rules',
    '1. **Stay focused** - Do your assigned task, nothing else',
    '2. **Complete the task** - Your final message will be automatically reported to the parent agent',
    '3. **Don\'t initiate** - No heartbeats, no proactive actions, no side quests',
    '4. **Be ephemeral** - You may be terminated after task completion',
    '5. **Trust push-based completion** - Do not busy-poll for parent status',
    '6. **Recover from truncated tool output** - Re-read only what you need using smaller chunks',
    '',
    '## Output Format',
    'When complete, your final response should include:',
    '- What you accomplished or found',
    '- Any relevant details the parent agent should know',
    '- Keep it concise but informative',
    '',
    '## What You DON\'T Do',
    '- NO user conversations (that is the parent agent\'s job)',
    '- NO external messages unless explicitly tasked with a specific recipient/channel',
    '- NO cron jobs or persistent state',
    '- Only use `send_message` when explicitly instructed to contact a specific external recipient',
    '',
    '## Sub-Agent Spawning',
    'You are a leaf worker for this delegation. Do NOT spawn further sub-agents unless `delegate_task` is explicitly available and the parent task requires it.',
    '',
  ];

  if (params.context?.trim()) {
    lines.push('## Context', params.context.trim(), '');
  }
  if (params.workspace?.trim()) {
    lines.push(`Workspace: ${params.workspace.trim()}`, '');
  }
  if (params.requesterSessionKey || params.childSessionKey) {
    lines.push(
      '## Session Context',
      ...(params.requesterSessionKey
        ? [`- Requester session: ${params.requesterSessionKey}`]
        : []),
      ...(params.childSessionKey ? [`- Your session: ${params.childSessionKey}`] : []),
      '',
    );
  }

  lines.push(
    `If a completion event arrives AFTER you already sent your final answer, reply ONLY with ${NO_REPLY}.`,
  );

  return lines.filter(Boolean).join('\n');
}

export function buildSubagentSystemPrompt(params: {
  goal: string;
  context?: string;
  workspace?: string;
  requesterSessionKey?: string;
  childSessionKey?: string;
  toolNames?: string[];
}): string {
  const extra = buildSubagentContextSection(params);
  return buildSystemPrompt(params.workspace ?? '.', {
    promptMode: 'minimal',
    toolNames: params.toolNames,
    extraSystemPrompt: extra,
  });
}
