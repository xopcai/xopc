/** Short human labels for manifest `ui.permissions` (EN). */
const PERMISSION_LABELS_EN: Record<string, string> = {
  'capability:xopc.notes.create': 'Create notes in this workspace',
  'capability:xopc.notes.update': 'Change notes in this workspace at an exact revision',
  'capability:xopc.notes.append': 'Append content to notes in this workspace',
  'capability:xopc.notes.get': 'Read notes in this workspace by ID',
  'capability:xopc.notes.list': 'Search and list notes in this workspace',
  'capability:xopc.tasks.get': 'Read tasks and their context in this workspace',
  'capability:xopc.tasks.list': 'Search and list tasks in this workspace',
  theme: 'Read theme (light / dark)',
  'agent.send': 'Send messages to the assistant',
  'agent.subscribe': 'Receive live agent stream events for a chat',
  'session.read': 'List and open chat sessions',
  'config.read': 'Read plugin configuration',
  'config.write': 'Write plugin configuration',
  storage: 'Read and write plugin storage',
  notification: 'Show in-app notifications',
};

const PERMISSION_LABELS_ZH: Record<string, string> = {
  'capability:xopc.notes.create': '在当前工作区创建笔记',
  'capability:xopc.notes.update': '按精确版本修改当前工作区的笔记',
  'capability:xopc.notes.append': '向当前工作区的笔记追加内容',
  'capability:xopc.notes.get': '按 ID 读取当前工作区的笔记',
  'capability:xopc.notes.list': '搜索和列出当前工作区的笔记',
  'capability:xopc.tasks.get': '读取当前工作区的任务及其上下文',
  'capability:xopc.tasks.list': '搜索和列出当前工作区的任务',
  theme: '读取主题（浅色/深色）',
  'agent.send': '向助手发送消息',
  'agent.subscribe': '接收会话的实时助手流式事件',
  'session.read': '列出并打开聊天会话',
  'config.read': '读取插件配置',
  'config.write': '写入插件配置',
  storage: '读写插件存储',
  notification: '显示应用内通知',
};

export function describePermission(permission: string, language: string): string {
  const en = PERMISSION_LABELS_EN[permission];
  if (language === 'zh' && PERMISSION_LABELS_ZH[permission]) {
    return PERMISSION_LABELS_ZH[permission];
  }
  return en ?? permission;
}
