import type { StoredLanguage } from '@/lib/storage';

export const focusCopy = (language: StoredLanguage) => language === 'zh' ? {
  current: '当前关注事项', candidates: '可能值得关注', candidatesHint: '根据近期工作识别，确认后才会开始关注。',
  progress: '进展监测', external: '外部动态监测', enableProgress: '开启进展监测', enableExternal: '开启外部动态监测',
  disableMonitor: '关闭监测',
  enabled: '已开启', disabled: '未开启', queued: '等待运行', running: '正在检查', failed: '运行失败',
  lastRun: '上次运行', nextRun: '下次运行', neverRun: '尚未运行', runNow: '立即运行',
  pause: '暂停关注', resume: '恢复关注', complete: '标记完成', remove: '移除关注',
  accept: '加入关注', dismiss: '不关注', details: '查看详情', latest: '最新发现', activity: '活动记录',
  evidence: '证据', why: '为什么重要', next: '建议下一步', investigate: '继续调查',
  operationDone: '操作已完成', monitorStarted: '监测已开启，首次检查已加入队列', monitorStopped: '监测已关闭',
  empty: '还没有关注事项', emptyHint: '从建议中加入，或让助手识别值得持续关注的工作。', back: '返回工作台', retry: '重试',
  deleteConfirm: '确定移除这个关注事项？相关监测和历史记录也会被删除。', noActivity: '还没有活动记录', noInsights: '尚未发现需要你关注的变化',
} : {
  current: 'Current focuses', candidates: 'Worth watching', candidatesHint: 'Detected from recent work. Nothing is monitored until you confirm.',
  progress: 'Progress monitoring', external: 'External change monitoring', enableProgress: 'Enable progress monitoring', enableExternal: 'Enable external monitoring',
  disableMonitor: 'Disable monitoring',
  enabled: 'Enabled', disabled: 'Not enabled', queued: 'Queued', running: 'Checking now', failed: 'Run failed',
  lastRun: 'Last run', nextRun: 'Next run', neverRun: 'Not run yet', runNow: 'Run now',
  pause: 'Pause focus', resume: 'Resume focus', complete: 'Mark complete', remove: 'Remove focus',
  accept: 'Add focus', dismiss: 'Dismiss', details: 'View details', latest: 'Latest findings', activity: 'Activity',
  evidence: 'Evidence', why: 'Why it matters', next: 'Suggested next step', investigate: 'Investigate',
  operationDone: 'Done', monitorStarted: 'Monitoring is enabled and the first check is queued', monitorStopped: 'Monitoring is disabled',
  empty: 'No focuses yet', emptyHint: 'Add one from suggestions or ask the assistant to find work worth watching.', back: 'Back to work', retry: 'Retry',
  deleteConfirm: 'Remove this focus? Its monitors and history will also be deleted.', noActivity: 'No activity yet', noInsights: 'No important changes found yet',
};
