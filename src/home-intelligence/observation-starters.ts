import type { ObservationStarter, ObservationState } from '@xopcai/gateway-contract';

const patterns: Record<ObservationStarter['kind'], RegExp> = {
  pr_review: /(?:审查|审阅|评审|review)[\s\S]{0,80}\b(?:pr|pull request)\b/i,
  issue_digest: /排查|排障|故障|(?:查看|查找|总结|跟进)[\s\S]{0,40}(?:问题|阻塞)|troubleshoot|debug|incident/i,
  work_summary: /周报|日报|工作[\s\S]{0,20}(?:总结|进展)|总结[\s\S]{0,20}(?:项目|工作)|weekly (?:report|summary)|status update/i,
};

/** A repeat request is a starting point, not a claim that its work has been completed or automated. */
export function observationStarters(state: ObservationState): ObservationStarter[] {
  if (state.status !== 'active') return [];
  return (Object.entries(patterns) as [ObservationStarter['kind'], RegExp][]).flatMap(([kind, pattern]) => {
    const topics = state.topics.filter(t => !t.routine && !t.trials.length);
    const matching = topics.flatMap(topic => topic.entries.filter(e => e.kind === 'user_work' && pattern.test(e.text))
      .map(entry => ({ topicId: topic.id, entry })));
    const unique = [...new Map(matching.map(item => [item.entry.id, item])).values()];
    const topicIds = [...new Set(unique.map(item => item.topicId))].slice(0, 8);
    const chosen = unique.filter(item => topicIds.includes(item.topicId));
    return chosen.length < 2 ? [] : [{ kind, topicIds, requestCount: chosen.length, previews: chosen.slice(-2).map(item => item.entry.text.slice(0, 120)) }];
  });
}
