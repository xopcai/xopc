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
