export function proactiveCopy(zh: boolean) {
  return zh ? {
    locale: 'zh', levels: { quiet: '尽量安静', balanced: '重要时找我', active: '及时跟进' }, save: '保存', saved: '已保存',
    level: '什么时候找你',
    quietStart: '免打扰开始（小时）', quietEnd: '免打扰结束（小时）', timezone: '时区', limit: '每日通知上限', pause: '暂停一小时', resume: '结束暂停',
    privacy: '提醒频率不会改变助理可以查看或执行的范围；这些范围仍按每件事的授权执行。',
    whyNow: '为什么现在', evidence: '依据', snooze: '一小时后', retry: '重试',
    kinds: { briefing: '简报', reminder: '提醒', risk: '风险', recommendation: '建议', decision: '待决定', receipt: '执行回执' },
  } : {
    locale: 'en', levels: { quiet: 'Keep it quiet', balanced: 'When it matters', active: 'Keep me updated' }, save: 'Save', saved: 'Saved',
    level: 'When should the assistant notify you?',
    quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', timezone: 'Timezone', limit: 'Daily notification limit', pause: 'Pause for one hour', resume: 'Resume',
    privacy: 'Notification frequency does not change what the assistant can read or do. Each delegated item keeps its own permissions.',
    whyNow: 'Why now', evidence: 'Evidence', snooze: 'In one hour', retry: 'Retry',
    kinds: { briefing: 'Briefing', reminder: 'Reminder', risk: 'Risk', recommendation: 'Recommendation', decision: 'Decision', receipt: 'Receipt' },
  };
}
export type ProactiveCopy = ReturnType<typeof proactiveCopy>;

export function localizedTemplate(key: string, fallback: { title: string; description: string }, locale: string) {
  if (locale !== 'zh') return fallback;
  const templates: Record<string, [string, string]> = {
    communication_follow_up: ['邮件跟进', '关注已委托的邮件往来，准备跟进草稿并持续等待回复。'],
    meeting_preparation: ['会议准备', '在会议前检查议程与资料，提示需要提前准备的事项。'],
    project_delivery_risk: ['项目交付风险', '关注项目任务、依赖与承诺，发现可能影响交付的变化。'],
    automation_failure_impact: ['自动化失败影响', '分析自动化故障的实际影响，提醒需要你处理的问题。'],
    blocked_work: ['工作阻塞', '检查受阻任务及依赖，指出下一步可以推进的工作。'],
    discussion_follow_up: ['讨论后续', '关注讨论中的结论与未完成事项，提示需要跟进的行动。'],
  };
  const value = templates[key];
  return value ? { title: value[0], description: value[1] } : fallback;
}
export function cardStatusLabel(value: string, locale: string): string {
  const labels = locale === 'zh'
    ? { unread: '待查看', read: '已查看', snoozed: '稍后提醒', resolved: '已收起', expired: '已过期', withdrawn: '来源已撤回' }
    : { unread: 'Ready to review', read: 'Reviewed', snoozed: 'Remind later', resolved: 'Dismissed', expired: 'Expired', withdrawn: 'Source withdrawn' };
  return labels[value as keyof typeof labels] ?? value;
}
