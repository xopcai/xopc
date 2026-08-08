const CORE_TOOL_ORDER = [
  'code_search',
  'code_read_symbol',
  'code_trace',
  'code_impact',
  'code_architecture',
  'read_file',
  'write_file',
  'apply_patch',
  'grep',
  'find',
  'list_dir',
  'exec_command',
  'update_plan',
  'web_search',
  'web_fetch',
  'web_extract',
  'browser_use',
  'send_message',
  'send_media',
  'memory_search',
  'memory_get',
  'session_search',
  'curated_memory',
  'session_status',
  'tool_manual',
  'delegate_task',
  'workflow',
  'automation',
  'skills_list',
  'skill_view',
  'skill_manage',
  'skills_marketplace_search',
  'skill_install',
  'todo',
  'clarify',
  'text_to_speech',
  'image',
  'image_generate',
  'create_share',
  'execute_code',
] as const;

const CORE_TOOL_SUMMARIES: Record<string, string> = {
  code_search: 'Find definitions, implementations, routes, types, and structurally important symbols',
  code_read_symbol: 'Read exact source for a graph symbol before editing',
  code_trace: 'Trace callers, callees, data flow, and cross-service paths',
  code_impact: 'Map git changes to affected symbols and blast radius',
  code_architecture: 'Map packages, boundaries, layers, entry points, hotspots, and clusters',
  read_file: 'Read targeted file contents before editing',
  write_file: 'Create new files or intentional complete rewrites; prefer apply_patch for code changes',
  apply_patch: 'Apply source edits with patches that begin exactly with *** Begin Patch and end exactly with *** End Patch',
  grep: 'Search file contents for literals, errors, config values, and docs',
  find: 'Find files by glob pattern',
  list_dir: 'List directory contents',
  exec_command: 'Run tests, type checks, builds, package scripts, and safe inspection commands',
  update_plan: 'Keep the current multi-step coding plan visible and accurate',
  web_search: 'Search the web',
  web_fetch: 'Fetch and extract readable content from a URL',
  web_extract: 'Extract structured content from a URL',
  browser_use: 'Control the configured browser',
  send_message: 'Send messages to the current conversation or an explicit configured channel',
  send_media: 'Send media attachments to the current channel',
  memory_search: 'Semantic search over indexed memory sources',
  memory_get: 'Read specific lines from memory sources returned by search',
  session_search: 'Search other chat sessions or list recent sessions',
  curated_memory: 'Read/write structured notes in the shared user memory store/',
  session_status: 'Show session usage/time/model state',
  tool_manual: 'Load built-in usage manuals for complex tools',
  delegate_task: 'Spawn an isolated sub-agent for a delegated task',
  workflow: 'Start a persisted multi-phase workflow run',
  automation: 'Manage product automations',
  skills_list: 'List available skills',
  skill_view: 'Load a skill SKILL.md or sub-documents',
  skill_manage: 'Create or update skills on disk',
  skills_marketplace_search: 'Search and rank skills across Store, ClawHub, and skills.sh without installing',
  skill_install: 'Install a skill from an explicit Git, archive, file, or local source after confirmation',
  todo: 'Manage in-session todo items',
  clarify: 'Ask the user a blocking clarification question',
  text_to_speech: 'Send a standalone voice message',
  image: 'Analyze an image with the configured vision model',
  image_generate: 'Generate images with the configured image model',
  create_share: 'Create a shareable link for workspace files',
  execute_code: 'Run code in a sandbox with a restricted tool subset',
};

export function buildToolingSection(params: {
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
}): string {
  const rawToolNames = (params.toolNames ?? []).map((tool) => tool.trim()).filter(Boolean);
  const canonicalByNormalized = new Map<string, string>();
  for (const name of rawToolNames) {
    const normalized = name.toLowerCase();
    if (!canonicalByNormalized.has(normalized)) {
      canonicalByNormalized.set(normalized, name);
    }
  }
  const resolveToolName = (normalized: string) =>
    canonicalByNormalized.get(normalized) ?? normalized;

  const normalizedTools = rawToolNames.map((tool) => tool.toLowerCase());
  const availableTools = new Set(normalizedTools);

  const externalToolSummaries = new Map<string, string>();
  for (const [key, value] of Object.entries(params.toolSummaries ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || !value?.trim()) {
      continue;
    }
    externalToolSummaries.set(normalized, value.trim());
  }

  const extraTools = Array.from(
    new Set(normalizedTools.filter((tool) => !CORE_TOOL_ORDER.includes(tool as (typeof CORE_TOOL_ORDER)[number]))),
  );
  const enabledTools = CORE_TOOL_ORDER.filter((tool) => availableTools.has(tool));
  const toolLines = enabledTools.map((tool) => {
    const summary = CORE_TOOL_SUMMARIES[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });
  for (const tool of extraTools.toSorted()) {
    const summary = CORE_TOOL_SUMMARIES[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
  }

  const execToolName = resolveToolName('exec_command');
  const planToolName = resolveToolName('update_plan');
  const readToolName = resolveToolName('read_file');
  const patchToolName = resolveToolName('apply_patch');
  const writeToolName = resolveToolName('write_file');
  const grepToolName = resolveToolName('grep');
  const findToolName = resolveToolName('find');
  const hasDelegate = availableTools.has('delegate_task');
  const hasWorkflow = availableTools.has('workflow');
  const hasToolManual = availableTools.has('tool_manual');
  const hasRead = availableTools.has('read_file');
  const hasPatch = availableTools.has('apply_patch');
  const hasWrite = availableTools.has('write_file');
  const hasGrep = availableTools.has('grep');
  const hasFind = availableTools.has('find');
  const hasExec = availableTools.has('exec_command');
  const hasPlan = availableTools.has('update_plan');

  const orchestrationLines: string[] = [];
  if (hasDelegate) {
    orchestrationLines.push(
      '- Sub-agent delegation → use `delegate_task(goal, context?, toolset?)` for focused parallel work; results return to you automatically.',
    );
  }
  if (hasWorkflow) {
    orchestrationLines.push(
      '- Multi-phase workflows → use `workflow` to start persisted runs with subagents when a script defines phases.',
    );
  }

  return [
    '## Tooling',
    'Tool availability (filtered by policy):',
    'Tool names are case-sensitive. Call tools exactly as listed.',
    toolLines.length > 0
      ? toolLines.join('\n')
      : '- No tools are registered for this session.',
    `For long waits, avoid rapid poll loops: use \`${execToolName}\` with a sufficient timeout or poll in reasonable intervals.`,
    hasRead
      ? `Use \`${readToolName}\` for targeted file inspection before editing; do not rely on filenames alone.`
      : '',
    hasPatch
      ? `Use \`${patchToolName}\` for source changes; keep patches focused and inspect failures carefully.`
      : '',
    hasWrite
      ? `Use \`${writeToolName}\` only for new files or intentional complete rewrites.`
      : '',
    hasGrep || hasFind
      ? `Use ${[
          hasGrep ? `\`${grepToolName}\`` : '',
          hasFind ? `\`${findToolName}\`` : '',
        ].filter(Boolean).join(' and ')} for text/file discovery; use code graph or symbol tools when available for definitions and call relationships.`
      : '',
    hasExec
      ? `Use \`${execToolName}\` for verification and safe inspection, not routine file editing.`
      : '',
    hasPlan
      ? `Use \`${planToolName}\` for multi-step coding work: keep exactly one active step when work is in progress, and update it after meaningful progress or review.`
      : '',
    hasToolManual
      ? 'Some complex tools have built-in manuals. Use `tool_manual(tool)` before non-trivial use.'
      : '',
    hasDelegate
      ? 'If a task is complex or long-running, delegate it. Completion is push-based: the sub-agent result returns when done.'
      : '',
    ...orchestrationLines,
    'Do not poll delegate/workflow status in a tight loop; check on-demand or wait for completion.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function hasSkillsTools(toolNames: string[]): boolean {
  const normalized = new Set(toolNames.map((t) => t.toLowerCase()));
  return normalized.has('skills_list') || normalized.has('skill_view');
}
