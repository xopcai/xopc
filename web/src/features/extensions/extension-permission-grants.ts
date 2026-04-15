const STORAGE_KEY = 'xopc.extensionUiGrants.v1';

function permissionFingerprint(permissions: string[]): string {
  return [...permissions].map((p) => p.trim()).filter(Boolean).sort().join('\0');
}

export function hasUiGrant(extensionId: string, permissions: string[]): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    return map[extensionId] === permissionFingerprint(permissions);
  } catch {
    return false;
  }
}

export function saveUiGrant(extensionId: string, permissions: string[]): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  const map = (raw ? (JSON.parse(raw) as Record<string, string>) : {}) ?? {};
  map[extensionId] = permissionFingerprint(permissions);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/** Short human labels for manifest `ui.permissions` (EN). */
const PERMISSION_LABELS_EN: Record<string, string> = {
  theme: 'Read theme (light / dark)',
  'agent.send': 'Send messages to the assistant',
  'agent.subscribe': 'Receive live agent stream events for a chat',
  'session.read': 'List and open chat sessions',
  'session.write': 'Modify chat sessions',
  'config.read': 'Read extension configuration',
  'config.write': 'Write extension configuration',
  storage: 'Read and write extension storage',
  notification: 'Show in-app notifications',
  clipboard: 'Use the clipboard',
  'workspace.read': 'Read workspace files',
  'workspace.write': 'Write workspace files',
};

const PERMISSION_LABELS_ZH: Record<string, string> = {
  theme: '读取主题（浅色/深色）',
  'agent.send': '向助手发送消息',
  'agent.subscribe': '接收会话的实时助手流式事件',
  'session.read': '列出并打开聊天会话',
  'session.write': '修改聊天会话',
  'config.read': '读取扩展配置',
  'config.write': '写入扩展配置',
  storage: '读写扩展存储',
  notification: '显示应用内通知',
  clipboard: '使用剪贴板',
  'workspace.read': '读取工作区文件',
  'workspace.write': '写入工作区文件',
};

export function describePermission(permission: string, language: string): string {
  const en = PERMISSION_LABELS_EN[permission];
  if (language === 'zh' && PERMISSION_LABELS_ZH[permission]) {
    return PERMISSION_LABELS_ZH[permission];
  }
  return en ?? permission;
}
