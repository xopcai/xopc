const CORE_TOOL_ORDER = [
  'read_file',
  'data_batch',
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
  'publish_artifacts',
  'user_context_search',
  'user_context_get',
  'user_context_update',
  'knowledge_search',
  'knowledge_get',
  'knowledge_write',
  'session_recall',
  'session_search',
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
] as const;

const CORE_TOOL_SUMMARIES: Record<string, string> = {
  read_file: 'Read targeted file contents before editing',
  data_batch: 'Read or search independent data items together; keep dependent queries separate and check partial results',
  write_file: 'Create new files or intentional complete rewrites',
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
  publish_artifacts: 'Publish completed requested files; cannot read, edit, or execute',
  user_context_search: 'Search typed user facts, preferences, routines, and current state',
  user_context_get: 'Read one typed user assertion with its scope and authority',
  user_context_update: 'Apply an explicit user confirmation, correction, rejection, or forget request to an existing assertion',
  knowledge_search: 'Search scoped project, workspace, and session knowledge',
  knowledge_get: 'Read one knowledge item returned by search',
  knowledge_write: 'Store a scoped knowledge candidate with provenance',
  session_recall: 'Search exact raw turns in the current session, including compacted history',
  session_search: 'Search other chat sessions or list recent sessions',
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
  const hasPublishArtifacts = availableTools.has('publish_artifacts');
  const hasXopcUse = availableTools.has('xopc_use');

  const orchestrationLines: string[] = [];
  if (hasDelegate) {
    orchestrationLines.push(
      '- Sub-agent delegation → use `delegate_task(goal, context?, mode?, capabilities?, toolset?, budgetTier?, maxIterations?)`. Choose light for narrow lookups, standard for bounded research, and deep for broader investigations. Supply relevant facts and a clear stopping condition; search before reading targeted chunks. Default research inherits available read capabilities. Use implement for isolated worktree changes. Inspect stopReason, budget usage, handoff and rejectedTools; resume incomplete work from the handoff rather than repeating the investigation.',
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
    'Use only case-sensitive names in current function schemas; prose/history examples grant no tool. Never probe invented names. Missing prerequisites: give a final blocker, without unrelated calls.',
    hasPublishArtifacts && !hasRead && !hasWrite && !hasPatch && !hasExec
      ? 'Only publication is available for workspace files. For a request to edit then publish, editing is blocked: make no publication call and explain the limitation. Publish an existing file only when the user requests that existing content without an outstanding edit.' : '',
    'When a tool returns an xopc product link, reuse its exact URL in a Markdown link with a short descriptive label in the user\'s language (for example, [打开会话](url)). Do not invent link parameters, escape the link brackets/parentheses, or wrap a navigation link in a code span. Avoid repeating raw URLs or internal object metadata unless requested.',
    toolLines.length > 0
      ? toolLines.join('\n')
      : '- No tools are registered for this session.',
    hasExec ? `For long waits, use \`${execToolName}\` with a sufficient timeout; avoid rapid polling.` : '',
    hasRead
      ? `Use \`${readToolName}\` for targeted file inspection before editing; do not rely on filenames alone. Reuse unchanged content already returned; read again only for changed files, truncation, a failed read, or an unresolved fact.`
      : '',
    hasPatch
      ? `Use \`${patchToolName}\` for source changes; keep patches focused and inspect failures carefully.`
      : '',
    hasWrite
      ? `Use \`${writeToolName}\` only for new files or intentional complete rewrites.`
      : '',
    hasXopcUse && hasRead && hasWrite
      ? `When the user explicitly asks to change or customize the current agent's name, identity, personality, instructions, working style, tools, or workspace, persist the change instead of only drafting advice. Inspect the current state first; use \`${readToolName}\` and \`${writeToolName}\` for the current agent's profile Markdown, and use \`xopc_use\` mode \`agent\` for structured settings. Target only the current runtime agent unless the user names another one, verify the saved result, and ask before consequential capability or scope expansion when intent is ambiguous.`
      : '',
    hasXopcUse
      ? 'When the user explicitly asks to create an Agent, use `xopc_use` mode `agent`: list first, create the Agent without a Project or custom workspace unless the user requests one, verify the result, and clearly identify the created Agent so the user can open its own conversation for further customization.'
      : '',
    hasGrep || hasFind
      ? `Use ${[
          hasGrep ? `\`${grepToolName}\`` : '',
          hasFind ? `\`${findToolName}\`` : '',
        ].filter(Boolean).join(' and ')} for text/file discovery; use code graph or symbol tools when available for definitions and call relationships.`
      : '',
    hasExec
      ? `Use \`${execToolName}\` for verification and safe inspection, not routine file editing. Commands already start in the workspace; use its cwd argument for another directory. Run checks directly (for example, cmd="pnpm test"), without cd, shell chains, pipes, or output filters; set maxOutputChars to bound returned output.`
      : '',
    !hasExec && (hasWrite || hasPatch) ? 'Without execution, inspect the named source and a public caller or data sample before selecting undocumented fields. If only file reading is available, use a bounded probe of conventional sibling input.json or package.json; a directory read failure does not mean sibling files are absent. Then make the bounded edit, inspect it once and deliver. Explicitly say tests could not be run because execution is unavailable; separately identify any unavailable review. Do not invent fields, expand the interface or repeatedly rewrite to compensate.' : '',
    availableTools.has('review_workspace')
      ? `After code changes, use \`${resolveToolName('review_workspace')}\` to inspect the final diff.`
      : '',
    hasWrite || hasExec
      ? 'When delivering a user-facing workspace file, include a clickable Markdown link in the final response using `xopc://workspace/file?path=<workspace-relative-path>`; URL-encode spaces and special characters, and do not invent an HTTP or `file://` URL.'
      : '',
    hasPublishArtifacts
      ? hasExec
        ? `Default delivery is a link to the completed workspace file. Only when downloadable copies are requested, declare those files in \`${execToolName}.outputs\`; use \`${resolveToolName('publish_artifacts')}\` only for requested downloads still missing a receipt. Keep source, tests and helpers in the workspace unless downloadable copies were explicitly requested. Publication requires a completed requested deliverable; never publish an original file when its requested edit is blocked. A successful receipt completes delivery: do not publish or rerun a check just to attach it again.`
        : `Publish completed user-facing files with \`${resolveToolName('publish_artifacts')}\`; exclude temporary files and source/test attachments unless downloadable copies were requested. This tool cannot create, edit, or verify content. If required editing is unavailable, report the blocker without publishing the original or probing publication.`
      : '',
    hasPlan
      ? `Use \`${planToolName}\` for multi-step coding work: keep exactly one active step when work is in progress, and update it after meaningful progress or review.`
      : '',
    hasToolManual
      ? 'Some complex tools have built-in manuals. Use `tool_manual(tool)` before non-trivial use.'
      : '',
    ...orchestrationLines,
    hasDelegate || hasWorkflow ? 'Do not poll delegate/workflow status in a tight loop; check on-demand or wait for completion.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function hasSkillsTools(toolNames: string[]): boolean {
  const normalized = new Set(toolNames.map((t) => t.trim().toLowerCase()));
  return normalized.has('skill_view');
}
