import { XopcChatAgent } from '../model/chat';

class XopcBuiltInAgentCopy {
  readonly name: Resource;
  readonly description: Resource;
  readonly defaultNames: string[];
  readonly defaultDescriptions: string[];

  constructor(name: Resource, description: Resource, defaultNames: string[], defaultDescriptions: string[]) {
    this.name = name;
    this.description = description;
    this.defaultNames = defaultNames;
    this.defaultDescriptions = defaultDescriptions;
  }
}

// Match the Web catalog defaults. Preserve names and descriptions edited by the user.
function createBuiltInCopies(): Map<string, XopcBuiltInAgentCopy> {
  return new Map<string, XopcBuiltInAgentCopy>([
    ['main', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_assistant_name'), $r('app.string.agent_builtin_assistant_description'),
      ["main", "Main", "Smart Assistant"], ["General assistant", "General-purpose personal assistant.", "Your personal intelligent assistant for answering questions, handling everyday tasks, and chatting with you anytime."])],
    ['conductor', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_conductor_name'), $r('app.string.agent_builtin_conductor_description'),
      ["conductor", "Conductor"], ["Talks with the user, delegates complex work to specialist Agents, and delivers verified results.", "User-facing coordination Agent for task planning, delegation, progress, verification, and reporting to the user."])],
    ['task-router', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_task_router_name'), $r('app.string.agent_builtin_task_router_description'),
      ["task-router", "Task Router"], ["Selects one suitable specialist for a delegated task."])],
    ['coder', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_coding_name'), $r('app.string.agent_builtin_coding_description'),
      ["coder", "Coder", "Coding Expert"], ["Software development, debugging, refactoring, and tests.", "Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review."])],
    ['writer', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_writing_name'), $r('app.string.agent_builtin_writing_description'),
      ["writer", "Writer", "Writing Assistant"], ["Drafting, editing, rewriting, and audience-aware content."])],
    ['researcher', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_research_name'), $r('app.string.agent_builtin_research_description'),
      ["researcher", "Researcher", "Research Assistant"], ["Deep research, source comparison, and fact synthesis."])],
    ['data-analyst', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_data_name'), $r('app.string.agent_builtin_data_description'),
      ["data-analyst", "Data Analyst"], ["Data cleaning, analysis, visualization, and reproducible reports."])],
    ['creative', new XopcBuiltInAgentCopy($r('app.string.agent_builtin_creative_name'), $r('app.string.agent_builtin_creative_description'),
      ["creative", "Creative", "Creative Assistant"], ["Visual direction, image prompts, design critique, and creative options."])],
  ]);
}

let copies: Map<string, XopcBuiltInAgentCopy> | undefined;

function builtInCopy(agentId: string): XopcBuiltInAgentCopy | undefined {
  if (!copies) copies = createBuiltInCopies();
  return copies.get(agentId);
}

export function agentDefaultAvatar(agentId: string): Resource | undefined {
  return builtInCopy(agentId) ? $rawfile(`agent-avatars/${agentId}.png`) : undefined;
}

function isDefault(value: string, options: string[]): boolean {
  return options.some((option: string): boolean => option.toLowerCase() === value.toLowerCase());
}

export function agentDisplayName(agent: XopcChatAgent): ResourceStr {
  const copy = builtInCopy(agent.id);
  const name = agent.name?.trim() ?? '';
  return copy && (!name || isDefault(name, copy.defaultNames)) ? copy.name : name || agent.id;
}

export function agentDisplayDescription(agent: XopcChatAgent): ResourceStr {
  const copy = builtInCopy(agent.id);
  const description = agent.description?.trim() ?? '';
  if (/^personal-[a-f0-9]{12}$/.test(agent.id) && (!description ||
    isDefault(description, ['A personal AI that adapts its responses to the user and coordinates work.']))) {
    return $r('app.string.agent_personal_description');
  }
  return copy && (!description || isDefault(description, copy.defaultDescriptions)) ? copy.description : description;
}

export function agentExternalRuntimeKind(agent: XopcChatAgent): string {
  const raw = (agent.override?.execution?.kind ?? agent.execution?.kind ?? '').trim().toLowerCase();
  return raw;
}

export function isExternalAgent(agent: XopcChatAgent): boolean {
  return agentExternalRuntimeKind(agent).length > 0;
}

export function agentExternalRuntimeBadge(agent: XopcChatAgent): string {
  const kind = agentExternalRuntimeKind(agent);
  if (kind === 'codex') return 'Codex';
  if (kind === 'claude') return 'Claude';
  if (kind === 'agy') return 'AGY';
  return '';
}
