import type { ConnectorDefinition } from '../connectors/types.js';

type TaskSummary = { id: string; objective: string; description?: string };

const DOMAINS = [
  ['calendar', 'schedule', 'meeting', 'deadline', 'event', '日历', '日程', '会议', '截止', '预约'],
  ['email', 'gmail', 'outlook', 'mail', 'inbox', '邮件', '邮箱', '收件箱'],
  ['docs', 'document', 'notion', 'drive', 'knowledge', 'wiki', '文档', '知识库', '资料'],
  ['github', 'gitlab', 'code', 'repository', 'issue', '代码', '仓库', '开发'],
  ['slack', 'teams', 'chat', 'message', '消息', '群聊', '沟通'],
] as const;

export function buildTaskSourceRecommendations(
  definitions: ConnectorDefinition[],
  installedConnectorIds: Set<string>,
  tasks: TaskSummary[],
) {
  const recommendations: Array<{
    sourceId: string;
    sourceName: string;
    taskId: string;
    taskTitle: string;
    score: number;
  }> = [];

  for (const definition of definitions) {
    if (installedConnectorIds.has(definition.id)) continue;
    const sourceText = [definition.id, definition.displayName, definition.description, ...(definition.tags ?? [])]
      .join(' ')
      .toLowerCase();
    for (const task of tasks) {
      const taskText = `${task.objective} ${task.description ?? ''}`.toLowerCase();
      let score = 0;
      for (const keywords of DOMAINS) {
        if (keywords.some((keyword) => sourceText.includes(keyword)) && keywords.some((keyword) => taskText.includes(keyword))) {
          score += 3;
        }
      }
      const genericTerms = taskText.match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
      score += new Set(genericTerms.filter((term) => sourceText.includes(term))).size;
      if (score > 0) {
        recommendations.push({
          sourceId: definition.id,
          sourceName: definition.displayName,
          taskId: task.id,
          taskTitle: task.objective,
          score,
        });
      }
    }
  }

  return recommendations
    .sort((left, right) => right.score - left.score || left.sourceName.localeCompare(right.sourceName))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.sourceId === item.sourceId) === index)
    .slice(0, 3)
    .map(({ score: _score, ...item }) => item);
}
