import type { WorkDiscoveryRun } from './api';

export function understandingConversationStarter(
  run: WorkDiscoveryRun,
  language: 'en' | 'zh',
): string {
  const generated = run.result?.conversationStarter?.trim();
  if (generated) return generated;

  const primarySuggestion = run.result?.suggestions.find(
    (suggestion) => suggestion.id === run.result?.primarySuggestionId,
  ) ?? run.result?.suggestions[0];
  if (primarySuggestion?.actionPrompt.trim()) return primarySuggestion.actionPrompt.trim();

  const folderName = run.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? run.rootPath;
  if (language === 'zh') {
    return `请先结合 ${folderName} 当前目录和最近变更，帮我说明这个项目在做什么、现在最值得关注什么，以及建议我下一步从哪里开始。`;
  }
  return `Help me understand ${folderName}: explain what this project is doing, what matters most right now, and where I should start next.`;
}
