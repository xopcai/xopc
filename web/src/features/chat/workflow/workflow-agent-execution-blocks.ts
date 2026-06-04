/**
 * Map workflow subagent snapshot fields into chat message blocks so the drawer
 * can reuse {@link AssistantStepsTimeline} and {@link MarkdownView}.
 */

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages/messages.types';

import type { WorkflowAgentSnapshot, WorkflowAgentStep } from './workflow.types';

const LABEL_TO_TOOL: Record<string, string> = {
  'Run command': 'shell',
  'List directory': 'list_dir',
  'Write file': 'write_file',
  'Edit file': 'edit_file',
  'Fetch URL': 'web_fetch',
  'Open URL': 'open_url',
  'Search web': 'web_search',
  'Read file': 'read_file',
  'Search files': 'grep',
};

export function buildWorkflowAgentExecutionBlocks(
  agent: WorkflowAgentSnapshot,
): Array<ThinkingContent | ToolUseContent> {
  const blocks: Array<ThinkingContent | ToolUseContent> = [];

  for (const step of agent.steps ?? []) {
    blocks.push(workflowStepToToolBlock(step));
  }

  const stream = agent.streamText?.trim();
  if (stream) {
    blocks.push({
      type: 'thinking',
      text: stream,
      streaming: agent.status === 'running',
    });
  }

  return blocks;
}

function workflowStepToToolBlock(step: WorkflowAgentStep): ToolUseContent {
  const toolName = step.toolName?.trim() || LABEL_TO_TOOL[step.label] || step.label.toLowerCase().replace(/\s+/g, '_');
  return {
    type: 'tool_use',
    id: step.id,
    name: toolName,
    input: stepInput(toolName, step.detail),
    status: step.status === 'running' ? 'running' : step.status === 'error' ? 'error' : 'done',
  };
}

function stepInput(toolName: string, detail?: string): Record<string, unknown> {
  if (!detail?.trim()) return {};
  const n = toolName.toLowerCase().replace(/-/g, '_');
  if (n === 'read_file' || n === 'write_file' || n === 'edit_file') return { path: detail };
  if (n === 'list_dir' || n === 'ls') return { path: detail };
  if (n === 'shell') return { command: detail };
  if (n === 'grep' || n === 'rg' || n.includes('search')) return { query: detail };
  if (n === 'web_fetch' || n === 'open_url') return { url: detail };
  return { detail };
}
