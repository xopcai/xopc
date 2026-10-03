export function sessionContextCopy(language: string) {
  return language === 'zh' ? {
    title: '会话信息', work: '当前工作', sources: '关联来源', environment: '运行位置',
    independent: '独立会话', delegatedTasks: '派出任务', expand: '显示更多', collapse: '收起',
    session: '会话关联', task: '任务关联', recent: '最近引用', draft: '待发送', untitled: '未命名 Note', untitledSource: '未命名来源',
    unavailable: '暂无法查看', partialUnavailable: '部分信息暂无法查看', refresh: '重试', more: '仅显示前 20 项',
    local: '本地目录', worktree: 'Worktree', detached: '游离 HEAD',
    unavailableEnvironment: '运行目录不可用', newEnvironment: '在另一环境新建会话',
    copyEnvironmentPath: '复制环境路径', copied: '已复制',
  } : {
    title: 'Session info', work: 'Current work', sources: 'Related sources', environment: 'Run location',
    independent: 'Independent chat', delegatedTasks: 'Delegated tasks', expand: 'Show more', collapse: 'Show less',
    session: 'Linked to chat', task: 'Linked to task', recent: 'Recently used', draft: 'Pending send', untitled: 'Untitled Note', untitledSource: 'Untitled source',
    unavailable: 'Temporarily unavailable', partialUnavailable: 'Some details are unavailable', refresh: 'Retry', more: 'Showing the first 20 items',
    local: 'Local directory', worktree: 'Worktree', detached: 'Detached HEAD',
    unavailableEnvironment: 'Run directory unavailable', newEnvironment: 'New chat in another environment',
    copyEnvironmentPath: 'Copy environment path', copied: 'Copied',
  };
}
