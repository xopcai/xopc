/** Short human labels for manifest `ui.permissions` (EN). */
const PERMISSION_LABELS_EN: Record<string, string> = {
  theme: 'Read theme (light / dark)',
  'agent.send': 'Send messages to the assistant',
  'agent.subscribe': 'Receive live agent stream events for a chat',
  'session.read': 'List and open chat sessions',
  'config.read': 'Read extension configuration',
  'config.write': 'Write extension configuration',
  storage: 'Read and write extension storage',
  notification: 'Show in-app notifications',
};

const PERMISSION_LABELS_ZH: Record<string, string> = {
  theme: '读取主题（浅色/深色）',
  'agent.send': '向助手发送消息',
  'agent.subscribe': '接收会话的实时助手流式事件',
  'session.read': '列出并打开聊天会话',
  'config.read': '读取扩展配置',
  'config.write': '写入扩展配置',
  storage: '读写扩展存储',
  notification: '显示应用内通知',
};

export function describePermission(permission: string, language: string): string {
  const en = PERMISSION_LABELS_EN[permission];
  if (language === 'zh' && PERMISSION_LABELS_ZH[permission]) {
    return PERMISSION_LABELS_ZH[permission];
  }
  return en ?? permission;
}
