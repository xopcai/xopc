import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../capabilities/runtime/dispatcher.js';

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
}

export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
}

export interface McpResourceReadResult {
  [x: string]: unknown;
  contents: Array<
    | { uri: string; mimeType: string; text: string }
    | { uri: string; mimeType: string; blob: string }
  >;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  title?: string;
  description: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptResult {
  [x: string]: unknown;
  description: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
}

function visibleIds(dispatcher: CapabilityDispatcher, context: CapabilityContext): Set<string> {
  return new Set(dispatcher.list(context).map(item => item.id));
}

export function listMcpResources(dispatcher: CapabilityDispatcher, context: CapabilityContext): McpResourceDescriptor[] {
  context.assertCurrent?.();
  const visible = visibleIds(dispatcher, context);
  const resources: McpResourceDescriptor[] = [];

  if (visible.has('xopc.projects.list') || visible.has('xopc.tasks.list') || visible.has('xopc.notes.list')) {
    resources.push({
      uri: 'xopc://workspace/overview',
      name: 'workspace-overview',
      title: 'xopc Workspace Overview',
      description: 'Snapshot of active projects, recent tasks, and recent notes visible to this connection.',
      mimeType: 'application/json',
    });
  }
  if (visible.has('xopc.user_context.profile')) {
    resources.push({
      uri: 'xopc://user/context',
      name: 'user-context',
      title: 'User Profile & Collaboration Rules',
      description: 'Confirmed user profile, active goals, current priority windows, and active collaboration rules.',
      mimeType: 'application/json',
    });
  }
  if (visible.has('xopc.agent_runs.agents')) {
    resources.push({
      uri: 'xopc://agents/directory',
      name: 'agents-directory',
      title: 'xopc Specialist Agents Directory',
      description: 'Provisioned xopc Agents available for delegation along with their descriptions, specialties, and skills.',
      mimeType: 'application/json',
    });
  }
  if (visible.has('xopc.files.spaces')) {
    resources.push({
      uri: 'xopc://files/spaces',
      name: 'workspace-file-spaces',
      title: 'Workspace File Spaces',
      description: 'Accessible workspace file spaces (agent, project, and session roots).',
      mimeType: 'application/json',
    });
  }
  return resources;
}

export function listMcpResourceTemplates(dispatcher: CapabilityDispatcher, context: CapabilityContext): McpResourceTemplateDescriptor[] {
  context.assertCurrent?.();
  const visible = visibleIds(dispatcher, context);
  const templates: McpResourceTemplateDescriptor[] = [];

  if (visible.has('xopc.projects.get')) {
    templates.push({
      uriTemplate: 'xopc://projects/{id}',
      name: 'project-detail',
      title: 'Project Details',
      description: 'Read planning metadata, brief, success criteria, and version for a project by ID.',
      mimeType: 'application/json',
    });
  }
  if (visible.has('xopc.notes.get')) {
    templates.push({
      uriTemplate: 'xopc://notes/{id}',
      name: 'note-content',
      title: 'Note Markdown',
      description: 'Read a note’s markdown content and metadata by ID.',
      mimeType: 'text/markdown',
    });
  }
  if (visible.has('xopc.tasks.get')) {
    templates.push({
      uriTemplate: 'xopc://tasks/{id}',
      name: 'task-detail',
      title: 'Task Details',
      description: 'Read a task’s objective, status, dependencies, and version by ID.',
      mimeType: 'application/json',
    });
  }
  if (visible.has('xopc.files.get')) {
    templates.push({
      uriTemplate: 'xopc://files/{id}',
      name: 'workspace-file',
      title: 'Workspace File Content',
      description: 'Read the first chunk of a workspace file by its file resource ID (URL-encoded if needed).',
      mimeType: 'text/plain',
    });
  }
  if (visible.has('xopc.agent_runs.result')) {
    templates.push({
      uriTemplate: 'xopc://runs/{runId}/result',
      name: 'delegated-run-result',
      title: 'Delegated Run Result',
      description: 'Read the final answer, receipt, and artifact list for a delegated run owned by this connection.',
      mimeType: 'application/json',
    });
  }
  return templates;
}

export async function readMcpResource(
  uri: string,
  dispatcher: CapabilityDispatcher,
  context: CapabilityContext,
  filterOutput?: (capabilityId: string, result: unknown) => unknown,
): Promise<McpResourceReadResult> {
  context.assertCurrent?.();
  const visible = visibleIds(dispatcher, context);
  const callFiltered = async (capabilityId: string, input: Record<string, unknown>) => {
    const raw = await dispatcher.call(capabilityId, input, context);
    return filterOutput ? filterOutput(capabilityId, raw) : raw;
  };

  if (uri === 'xopc://workspace/overview') {
    const [projects, tasks, notes] = await Promise.all([
      visible.has('xopc.projects.list') ? callFiltered('xopc.projects.list', { limit: 15 }).catch(() => null) : null,
      visible.has('xopc.tasks.list') ? callFiltered('xopc.tasks.list', { limit: 15 }).catch(() => null) : null,
      visible.has('xopc.notes.list') ? callFiltered('xopc.notes.list', { limit: 15 }).catch(() => null) : null,
    ]);
    if (!projects && !tasks && !notes) {
      throw new CapabilityError('FORBIDDEN', 'Workspace overview is not accessible to this connection');
    }
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ projects, tasks, notes }),
      }],
    };
  }

  if (uri === 'xopc://user/context') {
    if (!visible.has('xopc.user_context.profile')) throw new CapabilityError('FORBIDDEN', 'User context is not granted');
    const data = await callFiltered('xopc.user_context.profile', {});
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  if (uri === 'xopc://agents/directory') {
    if (!visible.has('xopc.agent_runs.agents')) throw new CapabilityError('FORBIDDEN', 'Agent directory is not granted');
    const data = await callFiltered('xopc.agent_runs.agents', {});
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  if (uri === 'xopc://files/spaces') {
    if (!visible.has('xopc.files.spaces')) throw new CapabilityError('FORBIDDEN', 'Workspace file spaces are not granted');
    const data = await callFiltered('xopc.files.spaces', {});
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  const projectMatch = /^xopc:\/\/projects\/([^/]+)$/.exec(uri);
  if (projectMatch) {
    if (!visible.has('xopc.projects.get')) throw new CapabilityError('FORBIDDEN', 'Project read is not granted');
    const id = decodeURIComponent(projectMatch[1]!);
    const data = await callFiltered('xopc.projects.get', { id });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  const noteMatch = /^xopc:\/\/notes\/([^/]+)$/.exec(uri);
  if (noteMatch) {
    if (!visible.has('xopc.notes.get')) throw new CapabilityError('FORBIDDEN', 'Note read is not granted');
    const id = decodeURIComponent(noteMatch[1]!);
    const data = await callFiltered('xopc.notes.get', { id }) as { note?: { title?: string; markdown?: string } };
    const title = data.note?.title ? `# ${data.note.title}\n\n` : '';
    return {
      contents: [{
        uri,
        mimeType: 'text/markdown',
        text: `${title}${data.note?.markdown ?? ''}`,
      }],
    };
  }

  const taskMatch = /^xopc:\/\/tasks\/([^/]+)$/.exec(uri);
  if (taskMatch) {
    if (!visible.has('xopc.tasks.get')) throw new CapabilityError('FORBIDDEN', 'Task read is not granted');
    const id = decodeURIComponent(taskMatch[1]!);
    const data = await callFiltered('xopc.tasks.get', { id });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  const fileMatch = /^xopc:\/\/files\/(.+)$/.exec(uri);
  if (fileMatch) {
    if (!visible.has('xopc.files.get')) throw new CapabilityError('FORBIDDEN', 'File read is not granted');
    const id = decodeURIComponent(fileMatch[1]!);
    const data = await callFiltered('xopc.files.get', { id }) as {
      encoding: 'utf8' | 'base64'; data: string; mimeType?: string;
    };
    return {
      contents: [{
        uri,
        mimeType: data.mimeType ?? (data.encoding === 'utf8' ? 'text/plain' : 'application/octet-stream'),
        ...(data.encoding === 'utf8' ? { text: data.data } : { blob: data.data }),
      }],
    };
  }

  const runResultMatch = /^xopc:\/\/runs\/([^/]+)\/result$/.exec(uri);
  if (runResultMatch) {
    if (!visible.has('xopc.agent_runs.result')) throw new CapabilityError('FORBIDDEN', 'Run result read is not granted');
    const runId = decodeURIComponent(runResultMatch[1]!);
    const data = await callFiltered('xopc.agent_runs.result', { runId });
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
  }

  throw new CapabilityError('NOT_FOUND', `Unknown xopc resource URI: ${uri}`);
}

export function listMcpPrompts(dispatcher: CapabilityDispatcher, context: CapabilityContext): McpPromptDescriptor[] {
  context.assertCurrent?.();
  const visible = visibleIds(dispatcher, context);
  const prompts: McpPromptDescriptor[] = [];

  if (visible.has('xopc.projects.list') || visible.has('xopc.tasks.list') || visible.has('xopc.notes.list')) {
    prompts.push({
      name: 'xopc_workspace_briefing',
      title: 'Workspace Briefing',
      description: 'Generate a concise status briefing across active xopc projects, tasks, notes, and user priorities.',
      arguments: [
        { name: 'projectId', description: 'Optional project ID to focus the briefing on.', required: false },
      ],
    });
  }

  if (visible.has('xopc.agent_runs.agents') && visible.has('xopc.agent_runs.start')) {
    prompts.push({
      name: 'xopc_delegate_specialist',
      title: 'Delegate Work to xopc Agent',
      description: 'Select the best-fit xopc specialist Agent, attach relevant workspace references, and launch a tracked delegated run.',
      arguments: [
        { name: 'goal', description: 'The outcome or deliverable you want an xopc Agent to produce.', required: true },
        { name: 'projectId', description: 'Optional project ID to scope context and references.', required: false },
      ],
    });
  }

  if (visible.has('xopc.notes.create') || visible.has('xopc.tasks.create')) {
    prompts.push({
      name: 'xopc_capture_meeting_notes',
      title: 'Capture Notes & Follow-Up Tasks',
      description: 'Turn raw discussion or meeting content into a structured xopc note and actionable backlog tasks.',
      arguments: [
        { name: 'topic', description: 'Meeting or discussion topic.', required: true },
        { name: 'projectId', description: 'Optional project ID to associate with the note and tasks.', required: false },
      ],
    });
  }

  if (visible.has('xopc.projects.get')) {
    prompts.push({
      name: 'xopc_project_status_report',
      title: 'Project Status Report',
      description: 'Compile a structured progress report from a project’s milestones, tasks, recent notes, and updates.',
      arguments: [
        { name: 'projectId', description: 'Target xopc project ID.', required: true },
      ],
    });
  }

  return prompts;
}

export function getMcpPrompt(
  name: string,
  args: Record<string, string> | undefined,
  dispatcher: CapabilityDispatcher,
  context: CapabilityContext,
): McpPromptResult {
  context.assertCurrent?.();
  const available = listMcpPrompts(dispatcher, context);
  const descriptor = available.find(prompt => prompt.name === name);
  if (!descriptor) {
    throw new CapabilityError('NOT_FOUND', `Prompt not available for this connection: ${name}`);
  }

  const projectId = args?.projectId?.trim();
  const scopeNote = projectId ? `Focus strictly on projectId "${projectId}".` : 'Cover the user’s active workspace.';

  if (name === 'xopc_workspace_briefing') {
    return {
      description: descriptor.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Prepare a crisp executive briefing from xopc. ${scopeNote}`,
            '1. If available, call `xopc_user_context_profile` to align with active goals and priorities.',
            '2. Call `xopc_projects_list`, `xopc_tasks_list`, and `xopc_notes_list` (with `projectId` if specified).',
            '3. Highlight: (a) top priorities & deadlines, (b) blocked or in-progress tasks, (c) key recent notes/decisions, and (d) suggested next actions.',
          ].join('\n'),
        },
      }],
    };
  }

  if (name === 'xopc_delegate_specialist') {
    const goal = args?.goal?.trim() || 'Complete the requested task';
    return {
      description: descriptor.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Delegate the following goal to an xopc Agent: "${goal}". ${scopeNote}`,
            '1. Call `xopc_agent_runs_agents` to inspect available specialists, descriptions, and skills.',
            '2. Use `xopc_workspace_search` (and `xopc_files_search` if needed) to gather up to 8 relevant project, task, note, or file references.',
            '3. Call `xopc_agent_runs_start` with a clear title, detailed prompt, selected `agentId`, optional `projectId`, `references`, and a unique `idempotencyKey`.',
            '4. Report the returned `runId` and monitor progress via `xopc_agent_runs_events` / `xopc_agent_runs_get`, answering clarifications via `xopc_agent_runs_respond` if needed, then retrieve deliverables with `xopc_agent_runs_result`.',
          ].join('\n'),
        },
      }],
    };
  }

  if (name === 'xopc_capture_meeting_notes') {
    const topic = args?.topic?.trim() || 'Untitled discussion';
    return {
      description: descriptor.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Structure and save notes for "${topic}" into xopc. ${scopeNote}`,
            '1. Check existing notes via `xopc_workspace_search` to avoid duplicating an active note.',
            '2. Create a concise Markdown note with `xopc_notes_create` (or append with `xopc_notes_append`) containing Summary, Decisions, and Open Questions, using a unique `idempotencyKey`.',
            '3. For each concrete action item, call `xopc_tasks_create` in `backlog` or `ready` phase with clear `objective` and `acceptanceCriteria`.',
          ].join('\n'),
        },
      }],
    };
  }

  if (name === 'xopc_project_status_report') {
    if (!projectId) throw new CapabilityError('INVALID_INPUT', 'projectId argument is required');
    return {
      description: descriptor.description,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Compile a project status report for projectId "${projectId}".`,
            '1. Call `xopc_projects_get`, `xopc_projects_list_milestones`, and `xopc_projects_list_updates`.',
            '2. Call `xopc_tasks_list` and `xopc_notes_list` filtered by `projectId`.',
            '3. Summarize: Health & Goal Alignment, Milestone Progress, Completed vs Remaining Tasks, Risks/Blockers, and Proposed Next Update.',
          ].join('\n'),
        },
      }],
    };
  }

  throw new CapabilityError('NOT_FOUND', `Prompt not found: ${name}`);
}
