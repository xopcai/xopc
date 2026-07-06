// Tool-name → human-readable label helpers used by the steps drawer/summary.

export function toolNameKey(name: string): string {
  return name.toLowerCase().replace(/-/g, '_').trim();
}

export type FriendlyToolTitleLabels = {
  searchedWeb: string;
  readFile: string;
  runCommand: string;
  listDirectory: string;
  writeFile: string;
  editFile: string;
  openUrl: string;
  fetchUrl: string;
  unknownTool: string;
};

export function getFriendlyToolTitle(name: string, labels: FriendlyToolTitleLabels): string {
  const n = toolNameKey(name);
  if (n === 'shell') return labels.runCommand;
  if (n === 'list_dir' || n === 'ls') return labels.listDirectory;
  if (n === 'write_file') return labels.writeFile;
  if (n === 'edit_file') return labels.editFile;
  if (n === 'web_fetch') return labels.fetchUrl;
  if (n === 'open_url') return labels.openUrl;
  if (n === 'web_search' || n === 'brave_search' || n.includes('search')) return labels.searchedWeb;
  if (n === 'read_file' || n.includes('read_file') || n.includes('file_read')) return labels.readFile;
  return labels.unknownTool.replace('{{name}}', name.trim() || 'tool');
}
