export function sessionContextCopy(language: string) {
  return language === 'zh' ? {
    title: '会话上下文', work: '当前工作', sources: '关联资料', environment: '执行环境',
    emptyWork: '未关联项目或执行任务', emptySources: '未关联资料', emptyEnvironment: '会话创建后显示',
    session: '会话来源', task: '任务关联', draft: '待发送', untitled: '未命名 Note',
    unavailable: '不可用或无权访问', failed: '部分信息暂不可用，请刷新重试', refresh: '刷新',
    more: '仅显示前 20 项，更多资料请打开任务查看', local: 'Local · 本地目录', worktree: 'Local · Worktree',
    detached: '游离 HEAD', unavailableEnvironment: '目录不存在或环境尚未就绪',
    hint: '关联资料不代表模型已读取；待发送资料仅用于下一条消息。',
  } : {
    title: 'Session context', work: 'Current work', sources: 'Sources', environment: 'Environment',
    emptyWork: 'No project or execution task', emptySources: 'No linked sources', emptyEnvironment: 'Available after the session is created',
    session: 'Session source', task: 'Task reference', draft: 'Pending send', untitled: 'Untitled Note',
    unavailable: 'Unavailable or restricted', failed: 'Some details are unavailable. Refresh to retry.', refresh: 'Refresh',
    more: 'Showing the first 20 sources. Open the task for more.', local: 'Local · Directory', worktree: 'Local · Worktree',
    detached: 'Detached HEAD', unavailableEnvironment: 'Directory missing or environment not ready',
    hint: 'Linked sources do not mean the model has read them. Pending sources apply to the next message.',
  };
}
