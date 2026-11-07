/** Short human labels for manifest `ui.permissions` (EN). */
const PERMISSION_LABELS_EN: Record<string, string> = {
  'capability:xopc.agent.delegate': 'Delegate bounded text reasoning to the configured model (may incur costs)',
  'capability:xopc.notes.create': 'Create notes within the approved scope',
  'capability:xopc.notes.update': 'Change approved notes at an exact revision',
  'capability:xopc.notes.append': 'Append content to approved notes',
  'capability:xopc.notes.get': 'Read approved notes by ID',
  'capability:xopc.notes.list': 'Search and list approved notes',
  'capability:xopc.tasks.get': 'Read approved task summaries',
  'capability:xopc.tasks.list': 'Search and list approved task summaries',
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
  'capability:xopc.agent.delegate': '委托已配置模型执行有预算限制的文本推理（可能产生费用）',
  'capability:xopc.notes.create': '在授权范围内创建笔记',
  'capability:xopc.notes.update': '按精确版本修改授权范围内的笔记',
  'capability:xopc.notes.append': '向授权范围内的笔记追加内容',
  'capability:xopc.notes.get': '按 ID 读取授权范围内的笔记',
  'capability:xopc.notes.list': '搜索和列出授权范围内的笔记',
  'capability:xopc.tasks.get': '读取授权范围内的任务摘要',
  'capability:xopc.tasks.list': '搜索和列出授权范围内的任务摘要',
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
