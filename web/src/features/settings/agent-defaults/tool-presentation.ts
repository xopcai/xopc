/** Explicit presentation groups do not change runtime authorization. Unknown tools stay unclassified. */
const GROUPS: Record<string, string[]> = {
  read: ['read_file', 'read', 'list_directory', 'search_files', 'web_search', 'web_fetch', 'read_task'],
  files: ['apply_patch', 'write_file', 'edit_file'],
  execute: ['exec_command', 'execute_code', 'write_stdin'],
  devices: ['browser_use', 'computer_use', 'phone_use'],
  external: ['send_message', 'send_media', 'publish_artifact', 'publish_task_result'],
};
export function toolGroup(id: string): string { return Object.entries(GROUPS).find(([, ids]) => ids.includes(id))?.[0] ?? 'other'; }
export function toolGroupLabel(group: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = { read: ['读取与查找资料', 'Read and find information'], files: ['修改文件', 'Change files'], execute: ['运行命令与代码', 'Run commands and code'], devices: ['操作网页与设备', 'Control browsers and devices'], external: ['发送与发布内容', 'Send and publish content'], other: ['其他与组合工具', 'Other and compound tools'] };
  return (labels[group] ?? labels.other)[zh ? 0 : 1];
}
