export function proactiveCopy(zh: boolean) {
  return zh ? {
    locale: 'zh', title: '为你关注', subtitle: '持续关注你选择的事项，在有价值的变化时交付卡片。', cards: '动态卡片', templates: '主动服务', settings: '提醒设置',
    levels: { off: '关闭', quiet: '安静', balanced: '适中', active: '积极' }, inherit: '继承全局', save: '保存', saved: '已保存',
    level: '主动程度', delivery: '提醒方式', inbox: '仅展示卡片', important: '重要变化时通知', scope: '关注项目', enable: '启用', enabled: '已启用', paused: '已暂停',
    instructions: '关注偏好', instructionsHint: '例如：只有影响对外承诺时才提醒我。', interval: '兜底检查间隔（分钟，留空跟随程度）',
    connection: '会议准备需要已连接且允许主动分析的日历来源。', eventOnly: '此模板由业务事件触发。', meetingWindows: '会议前 24 小时和 2 小时检查。',
    quietStart: '免打扰开始（小时）', quietEnd: '免打扰结束（小时）', timezone: '时区', limit: '每日通知上限', pause: '暂停一小时', resume: '结束暂停',
    privacy: '主动程度只影响发现和提醒；自动执行权限仍由项目授权单独控制。Gateway 需要保持运行。',
    empty: '暂时没有需要关注的变化。你可以先启用一个主动服务。', all: '全部', unread: '未读', resolved: '已处理', more: '下一页', first: '返回首页',
    whyNow: '为什么现在', recommendation: '建议', evidence: '依据', investigated: '已检查', read: '标为已读', resolve: '已处理', snooze: '一小时后', less: '少提醒这类', pauseTemplate: '暂停此服务',
    expired: '已过期', result: '执行结果', retry: '重试', close: '返回卡片列表', runs: '检查记录', noRuns: '还没有检查记录', lastCheck: '上次扫描', nextCheck: '下次扫描',
    chooseProject: '选择项目', choose: '选择', loading: '正在处理',
    kinds: { briefing: '简报', reminder: '提醒', risk: '风险', recommendation: '建议', decision: '待决定', receipt: '执行回执' },
  } : {
    locale: 'en', title: 'For you', subtitle: 'Follow the work you choose and receive useful changes as cards.', cards: 'Cards', templates: 'Proactive services', settings: 'Notifications',
    levels: { off: 'Off', quiet: 'Quiet', balanced: 'Balanced', active: 'Active' }, inherit: 'Use global level', save: 'Save', saved: 'Saved',
    level: 'Proactive level', delivery: 'Delivery', inbox: 'Cards only', important: 'Notify on important changes', scope: 'Project', enable: 'Enable', enabled: 'Enabled', paused: 'Paused',
    instructions: 'What matters to you', instructionsHint: 'For example: only alert me when an external commitment is affected.', interval: 'Fallback scan interval (minutes; blank uses level)',
    connection: 'Meeting preparation needs a connected calendar authorized for proactive analysis.', eventOnly: 'This template runs on business events.', meetingWindows: 'Checks 24 hours and 2 hours before meetings.',
    quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', timezone: 'Timezone', limit: 'Daily notification limit', pause: 'Pause for one hour', resume: 'Resume',
    privacy: 'Proactive level controls discovery and notifications. Action permissions remain separate in project settings. Keep the Gateway running.',
    empty: 'No changes need attention yet. Enable a proactive service to get started.', all: 'All', unread: 'Unread', resolved: 'Resolved', more: 'Next page', first: 'First page',
    whyNow: 'Why now', recommendation: 'Recommendation', evidence: 'Evidence', investigated: 'Checked', read: 'Mark read', resolve: 'Resolve', snooze: 'In one hour', less: 'Fewer alerts like this', pauseTemplate: 'Pause service',
    expired: 'Expired', result: 'Result', retry: 'Retry', close: 'Back to cards', runs: 'Run history', noRuns: 'No runs yet', lastCheck: 'Last scan', nextCheck: 'Next scan',
    chooseProject: 'Choose a project', choose: 'Choose', loading: 'Working',
    kinds: { briefing: 'Briefing', reminder: 'Reminder', risk: 'Risk', recommendation: 'Recommendation', decision: 'Decision', receipt: 'Receipt' },
  };
}
export type ProactiveCopy = ReturnType<typeof proactiveCopy>;

export function localizedTemplate(key: string, fallback: { title: string; description: string }, locale: string) {
  if (locale !== 'zh') return fallback;
  const templates: Record<string, [string, string]> = {
    meeting_preparation: ['会议准备', '在会议前检查议程与资料，提示需要提前准备的事项。'],
    project_delivery_risk: ['项目交付风险', '关注项目任务、依赖与承诺，发现可能影响交付的变化。'],
    automation_failure_impact: ['自动化失败影响', '分析自动化故障的实际影响，提醒需要你处理的问题。'],
    blocked_work: ['工作阻塞', '检查受阻任务及依赖，指出下一步可以推进的工作。'],
    discussion_follow_up: ['讨论后续', '关注讨论中的结论与未完成事项，提示需要跟进的行动。'],
  };
  const value = templates[key];
  return value ? { title: value[0], description: value[1] } : fallback;
}
export function runLabel(value: string, locale: string): string {
  if (locale !== 'zh') return value.replaceAll('_', ' ');
  return ({ approval_required: '等待确认', executing: '正在执行', rejected: '已拒绝', completed: '已完成', insight: '已生成卡片', below_threshold: '未达到提醒标准', succeeded: '检查完成', succeeded_with_insight: '已生成卡片', succeeded_no_insight: '无须提醒', no_insight: '无须提醒', running: '检查中', pending: '等待检查', retryable: '等待重试', failed: '检查失败', discarded: '已取消', unchanged: '内容未变化', routine: '常规变化', insufficient_evidence: '证据不足', duplicate: '重复发现', disabled: '服务已关闭', source_unavailable: '来源不可用', low_value: '未达到提醒标准', policy_changed: '设置已变化' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ');
}
