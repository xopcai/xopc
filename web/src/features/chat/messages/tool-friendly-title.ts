import { resolveToolActivity, type ToolActivity } from '@xopcai/gateway-contract';

export type FriendlyToolTitleLabels = {
  searchedWeb: string;
  searchedMemory?: string;
  searchedCode?: string;
  searched?: string;
  readFile: string;
  runCommand: string;
  updatePlan?: string;
  listDirectory: string;
  writeFile: string;
  editFile: string;
  openUrl: string;
  fetchUrl: string;
  unknownTool: string;
};

export type ToolExecutionState = 'running' | 'completed';

type ToolExecutionLabel = Record<ToolExecutionState, string>;

export type ToolExecutionLabels = {
  builtins: Record<
    | 'automation'
    | 'browser'
    | 'clarification'
    | 'computer'
    | 'connection'
    | 'desktopPet'
    | 'delegation'
    | 'diagnostics'
    | 'imageGeneration'
    | 'imageInspection'
    | 'job'
    | 'manual'
    | 'mediaRead'
    | 'mediaSend'
    | 'memoryMaintenance'
    | 'memoryRead'
    | 'memoryUpdate'
    | 'message'
    | 'publish'
    | 'planning'
    | 'review'
    | 'sessionRecall'
    | 'sessionSearch'
    | 'sessionStatus'
    | 'share'
    | 'skillInstall'
    | 'skillManage'
    | 'skillSearch'
    | 'skillView'
    | 'speech'
    | 'structuredOutput'
    | 'todo'
    | 'webExtract'
    | 'workflow',
    ToolExecutionLabel
  >;
  actions: Record<
    | 'inspect'
    | 'create'
    | 'update'
    | 'remove'
    | 'run'
    | 'stop'
    | 'validate'
    | 'open'
    | 'continue'
    | 'use',
    ToolExecutionLabel
  >;
  objects: Record<
    | 'proactiveWork'
    | 'project'
    | 'milestone'
    | 'projectUpdate'
    | 'automation'
    | 'note'
    | 'task'
    | 'taskRun'
    | 'localApp'
    | 'settings',
    string
  >;
  fallback: ToolExecutionLabel;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

function normalizedToolId(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_').split('__').at(-1)?.split('.').at(-1) ?? '';
}

const BUILTIN_SEMANTICS: Readonly<Record<string, keyof ToolExecutionLabels['builtins']>> = {
  automation: 'automation',
  browser_automation: 'browser',
  browser_use: 'browser',
  clarify: 'clarification',
  computer_use: 'computer',
  create_desktop_pet: 'desktopPet',
  create_share: 'share',
  delegate_task: 'delegation',
  image_generate: 'imageGeneration',
  image: 'imageInspection',
  language_diagnostics: 'diagnostics',
  managed_job: 'job',
  memory_maintenance: 'memoryMaintenance',
  knowledge_get: 'memoryRead',
  knowledge_write: 'memoryUpdate',
  user_context_get: 'memoryRead',
  user_context_update: 'memoryUpdate',
  publish_artifacts: 'publish',
  update_plan: 'planning',
  read_media: 'mediaRead',
  review_workspace: 'review',
  send_media: 'mediaSend',
  send_message: 'message',
  session_recall: 'sessionRecall',
  session_search: 'sessionSearch',
  session_status: 'sessionStatus',
  skill_install: 'skillInstall',
  skill_manage: 'skillManage',
  skills_marketplace_search: 'skillSearch',
  skills_list: 'skillSearch',
  skill_view: 'skillView',
  text_to_speech: 'speech',
  structured_output: 'structuredOutput',
  todo: 'todo',
  tool_manual: 'manual',
  web_extract: 'webExtract',
  workflow: 'workflow',
  xopc_require_connection: 'connection',
};

export function hasSpecificToolExecutionTitle(name: string): boolean {
  const id = normalizedToolId(name);
  return id === 'xopc_use' || id in BUILTIN_SEMANTICS;
}

const XOPC_INSPECT_COMMANDS = new Set([
  'list', 'get', 'get_card', 'history', 'list_milestones', 'list_updates', 'mail_sources',
  'preview_edit', 'resolve_workspace',
]);
const XOPC_CREATE_COMMANDS = new Set(['create', 'create_milestone', 'create_update', 'follow_up', 'start']);
const XOPC_UPDATE_COMMANDS = new Set([
  'add_context', 'append', 'command', 'remove_context', 'update', 'update_dependencies',
  'update_follow_up', 'update_milestone',
]);
const XOPC_REMOVE_COMMANDS = new Set(['delete']);
const XOPC_RUN_COMMANDS = new Set(['run', 'resume']);
const XOPC_STOP_COMMANDS = new Set(['cancel', 'pause']);
const XOPC_VALIDATE_COMMANDS = new Set(['check', 'validate']);
const XOPC_OPEN_COMMANDS = new Set(['open']);
const XOPC_CONTINUE_COMMANDS = new Set(['continue_card']);

function xopcAction(command: string): keyof ToolExecutionLabels['actions'] {
  if (XOPC_INSPECT_COMMANDS.has(command)) return 'inspect';
  if (XOPC_CREATE_COMMANDS.has(command)) return 'create';
  if (XOPC_UPDATE_COMMANDS.has(command)) return 'update';
  if (XOPC_REMOVE_COMMANDS.has(command)) return 'remove';
  if (XOPC_RUN_COMMANDS.has(command)) return 'run';
  if (XOPC_STOP_COMMANDS.has(command)) return 'stop';
  if (XOPC_VALIDATE_COMMANDS.has(command)) return 'validate';
  if (XOPC_OPEN_COMMANDS.has(command)) return 'open';
  if (XOPC_CONTINUE_COMMANDS.has(command)) return 'continue';
  return 'use';
}

function xopcObject(
  mode: string,
  command: string,
): keyof ToolExecutionLabels['objects'] {
  if (mode === 'project' && command.includes('milestone')) return 'milestone';
  if (mode === 'project' && command.includes('update')) return 'projectUpdate';
  if (mode === 'project') return 'project';
  if (mode === 'automation') return 'automation';
  if (mode === 'note') return 'note';
  if (mode === 'task') return 'task';
  if (mode === 'task_run') return 'taskRun';
  if (mode === 'local_app') return 'localApp';
  if (mode === 'settings') return 'settings';
  return 'proactiveWork';
}

function humanizeToolName(name: string): string {
  const leaf = name.trim().split('__').at(-1)?.split('.').at(-1) ?? name.trim();
  return leaf.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'tool';
}

const GENERIC_ACTIONS: Readonly<Record<string, keyof ToolExecutionLabels['actions']>> = {
  list: 'inspect', get: 'inspect', read: 'inspect', fetch: 'inspect', find: 'inspect', search: 'inspect', query: 'inspect',
  create: 'create', add: 'create', generate: 'create', install: 'create',
  update: 'update', edit: 'update', write: 'update', append: 'update', set: 'update',
  delete: 'remove', remove: 'remove', uninstall: 'remove',
  run: 'run', execute: 'run', start: 'run', trigger: 'run',
  stop: 'stop', cancel: 'stop', pause: 'stop',
  validate: 'validate', check: 'validate', test: 'validate', verify: 'validate', analyze: 'validate', review: 'validate',
  open: 'open', navigate: 'open',
  continue: 'continue', resume: 'continue',
};

function inferredExternalTitle(
  name: string,
  state: ToolExecutionState,
  labels: ToolExecutionLabels,
): string | null {
  const humanized = humanizeToolName(name);
  const [verb, ...objectParts] = humanized.split(' ');
  const action = GENERIC_ACTIONS[verb.toLowerCase()];
  const object = objectParts.join(' ').trim();
  if (!action || !object) return null;
  return fill(labels.actions[action][state], { object });
}

/** Input-aware tool wording used by the chat execution trace. */
export function getToolExecutionTitle(
  name: string,
  input: unknown,
  state: ToolExecutionState,
  labels: ToolExecutionLabels,
  friendlyLabels: FriendlyToolTitleLabels,
  activity?: ToolActivity,
): string {
  const id = normalizedToolId(name);
  if (id === 'xopc_use') {
    const record = asRecord(input);
    const mode = typeof record?.mode === 'string' ? record.mode.trim().toLowerCase() : '';
    const command = typeof record?.command === 'string' ? record.command.trim().toLowerCase() : '';
    const action = xopcAction(command);
    const object = xopcObject(mode, command);
    return fill(labels.actions[action][state], { object: labels.objects[object] });
  }

  const builtin = BUILTIN_SEMANTICS[id];
  if (builtin) return labels.builtins[builtin][state];

  const semantic = activity ?? resolveToolActivity(name, state === 'running' ? 'running' : 'completed');
  if (semantic.category !== 'other' || semantic.action !== 'use') {
    return getFriendlyToolTitle(name, friendlyLabels, semantic);
  }

  return inferredExternalTitle(name, state, labels)
    ?? fill(labels.fallback[state], { name: humanizeToolName(name) });
}

export type ToolDisplayKind =
  | 'webSearch'
  | 'memorySearch'
  | 'codeSearch'
  | 'search'
  | 'readFile'
  | 'editFile'
  | 'writeFile'
  | 'runCommand'
  | 'listDir'
  | 'openUrl'
  | 'fetchUrl'
  | 'other';

export function classifyToolDisplay(name: string, activity?: ToolActivity): ToolDisplayKind {
  if (name === 'user_context_search' || name === 'knowledge_search') return 'memorySearch';
  const semantic = activity ?? resolveToolActivity(name, 'running');
  if (semantic.category === 'memory' && semantic.action === 'search') return 'memorySearch';
  if (semantic.category === 'web' && semantic.action === 'search') return 'webSearch';
  if (semantic.category === 'code' && semantic.action === 'search') return 'codeSearch';
  if (semantic.category === 'other' && semantic.action === 'search') return 'search';
  if (semantic.category === 'file' && semantic.action === 'read') return 'readFile';
  if (semantic.category === 'file' && semantic.action === 'list') return 'listDir';
  if (semantic.category === 'file' && semantic.action === 'write') return 'writeFile';
  if (semantic.category === 'file' && semantic.action === 'edit') return 'editFile';
  if (semantic.category === 'command' && semantic.action === 'execute') return 'runCommand';
  if (semantic.category === 'navigation' && semantic.action === 'open') return 'openUrl';
  if (semantic.category === 'web' && semantic.action === 'read') return 'fetchUrl';
  return 'other';
}

export function getFriendlyToolTitle(
  name: string,
  labels: FriendlyToolTitleLabels,
  activity?: ToolActivity,
): string {
  const semantic = activity ?? resolveToolActivity(name, 'running');
  if (semantic.category === 'planning') return labels.updatePlan ?? labels.unknownTool.replace('{{name}}', name);
  const kind = classifyToolDisplay(name, semantic);
  if (kind === 'webSearch') return labels.searchedWeb;
  if (kind === 'memorySearch') return labels.searchedMemory ?? labels.searched ?? labels.searchedWeb;
  if (kind === 'codeSearch') return labels.searchedCode ?? labels.searched ?? labels.searchedWeb;
  if (kind === 'search') return labels.searched ?? labels.searchedWeb;
  if (kind === 'readFile') return labels.readFile;
  if (kind === 'runCommand') return labels.runCommand;
  if (kind === 'listDir') return labels.listDirectory;
  if (kind === 'writeFile') return labels.writeFile;
  if (kind === 'editFile') return labels.editFile;
  if (kind === 'openUrl') return labels.openUrl;
  if (kind === 'fetchUrl') return labels.fetchUrl;
  return labels.unknownTool.replace('{{name}}', name.trim() || 'tool');
}
