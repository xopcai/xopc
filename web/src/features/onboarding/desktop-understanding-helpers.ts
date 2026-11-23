import type {
  WorkDiscoveryCandidate,
  WorkDiscoveryProfileCandidate,
  WorkDiscoveryRecentFile,
  WorkDiscoveryRun,
  WorkDiscoverySuggestion,
  WorkUnderstandingThread,
} from '@/features/work-discovery/api';

export type RevealEvidenceItem = { path?: string; observation: string };

export type TraitChip = {
  id: string;
  assertionId?: string;
  category: WorkDiscoveryProfileCandidate['category'] | 'custom';
  label: string;
  evidence?: string[];
};

export type ThreadCard = {
  id: string;
  kind: 'thread' | 'suggestion' | 'project';
  title: string;
  badge?: string;
  meta?: string;
  primary?: boolean;
  actionPrompt: string;
  priorityTitle: string;
  conversationId?: string;
  suggestion?: WorkDiscoverySuggestion;
  rootPath?: string;
};

export type LocalSignalItem =
  | {
    id: string;
    kind: 'project';
    label: string;
    meta?: string;
    candidate: WorkDiscoveryCandidate;
  }
  | {
    id: string;
    kind: 'file';
    label: string;
    meta: string;
    extension: string;
    file: WorkDiscoveryRecentFile;
  };

export type FallbackStarter = {
  id: string;
  icon: 'priorities' | 'meeting' | 'research';
  title: string;
  prompt: string;
  priorityTitle: string;
};

export function compactPath(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || value;
}

export function localizeRootLabel(label: string, zh: boolean): string {
  if (!zh) return label;
  const lower = label.toLowerCase();
  if (lower === 'desktop') return '桌面';
  if (lower === 'documents') return '文稿';
  if (lower === 'downloads') return '下载';
  return label;
}

export function buildLocalSignals(
  candidates: WorkDiscoveryCandidate[],
  recentFiles: WorkDiscoveryRecentFile[],
  excludedProjectIds: Set<string>,
  excludedFileIds: Set<string>,
  zh: boolean,
): LocalSignalItem[] {
  const items: LocalSignalItem[] = [];

  for (const candidate of candidates) {
    if (excludedProjectIds.has(candidate.id)) continue;
    if (items.length >= 2) break;
    const meta = candidate.changedFileCount > 0
      ? (zh ? `${candidate.changedFileCount} 处改动` : `${candidate.changedFileCount} changes`)
      : candidate.branch
        ? candidate.branch
        : undefined;
    items.push({
      id: candidate.id,
      kind: 'project',
      label: candidate.displayName,
      meta,
      candidate,
    });
  }

  for (const file of recentFiles) {
    if (excludedFileIds.has(file.id)) continue;
    if (items.length >= 6) break;
    items.push({
      id: file.id,
      kind: 'file',
      label: file.name,
      meta: localizeRootLabel(file.rootLabel, zh),
      extension: file.extension.toLowerCase(),
      file,
    });
  }

  return items;
}

export function buildFallbackStarters(zh: boolean): FallbackStarter[] {
  if (zh) {
    return [
      {
        id: 'starter:priorities',
        icon: 'priorities',
        title: '理清今天最重要的 3 件事',
        prompt: '帮我理清今天最重要的 3 件事。先问我 2 个最关键的问题，或者直接给我一份按影响力和紧迫度排序的行动清单框架。',
        priorityTitle: '理清今天最重要的 3 件事',
      },
      {
        id: 'starter:meeting',
        icon: 'meeting',
        title: '准备下一场重要会议',
        prompt: '我准备一场重要会议或汇报，请先给我一版精炼的议程与核心结论框架，并告诉我补充哪 2 个信息后可以直接写成完整材料。',
        priorityTitle: '准备重要会议或汇报',
      },
      {
        id: 'starter:research',
        icon: 'research',
        title: '快速调研并输出简报',
        prompt: '我想快速调研一个新主题并输出一份一页纸简报。请告诉我我只需提供什么关键词或目标，你就能立刻开始调研并整理结论。',
        priorityTitle: '快速调研并输出简报',
      },
    ];
  }
  return [
    {
      id: 'starter:priorities',
      icon: 'priorities',
      title: 'Clarify top 3 priorities',
      prompt: 'Help me clarify my top 3 priorities today. Ask at most 2 sharp questions or draft an impact-ordered action plan I can refine right away.',
      priorityTitle: 'Clarify top 3 priorities today',
    },
    {
      id: 'starter:meeting',
      icon: 'meeting',
      title: 'Prep an upcoming meeting',
      prompt: 'Help me prepare for an important upcoming meeting. Draft a concise agenda and key decision checklist, then ask for the 2 details you need to tailor it.',
      priorityTitle: 'Prepare for upcoming meeting',
    },
    {
      id: 'starter:research',
      icon: 'research',
      title: 'Research & draft a brief',
      prompt: 'I want to quickly research a topic and get a structured one-page brief. Ask for the topic and goal so you can start right away.',
      priorityTitle: 'Research a topic and write a brief',
    },
  ];
}

export function normalizeTraitChips(
  candidates: WorkDiscoveryProfileCandidate[],
  rejectedIds: Set<string>,
): TraitChip[] {
  const seen = new Set<string>();
  const chips: TraitChip[] = [];
  for (const item of candidates) {
    if (item.status === 'rejected' || rejectedIds.has(item.id)) continue;
    const label = item.statement.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const dedupeKey = label.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    chips.push({
      id: item.id,
      assertionId: item.assertionId,
      category: item.category,
      label,
      evidence: item.evidence,
    });
    if (chips.length >= 6) break;
  }
  return chips;
}

function horizonLabel(horizon: WorkUnderstandingThread['horizon'], zh: boolean): string {
  if (horizon === 'current') return zh ? '当下' : 'Now';
  if (horizon === 'ongoing') return zh ? '持续' : 'Ongoing';
  return zh ? '长期' : 'Long-term';
}

export function buildThreadCardsFromLocalUnderstanding(
  threads: WorkUnderstandingThread[],
  candidates: WorkDiscoveryCandidate[],
  recentFileCount: number,
  zh: boolean,
): ThreadCard[] {
  const cards: ThreadCard[] = [];

  for (const thread of threads.slice(0, 3)) {
    const sourceCount = thread.evidenceIds.length;
    cards.push({
      id: `thread:${thread.id}`,
      kind: 'thread',
      title: thread.title,
      badge: horizonLabel(thread.horizon, zh),
      meta: sourceCount > 0
        ? (zh ? `${sourceCount} 份相关线索` : `${sourceCount} clues`)
        : undefined,
      primary: cards.length === 0,
      actionPrompt: zh
        ? `围绕「${thread.title}」继续推进：${thread.summary ? `${thread.summary} ` : ''}先帮我快速列出当前最关键的 1–2 个下一步并开始第一步。`
        : `Let’s move forward on "${thread.title}": ${thread.summary ? `${thread.summary} ` : ''}Outline the top 1–2 next steps and start the first one right away.`,
      priorityTitle: thread.title,
    });
  }

  if (cards.length < 3) {
    for (const candidate of candidates) {
      if (cards.length >= 3) break;
      const alreadyMentioned = cards.some((card) => card.title.toLowerCase().includes(candidate.displayName.toLowerCase()));
      if (alreadyMentioned) continue;
      cards.push({
        id: `project-card:${candidate.id}`,
        kind: 'project',
        title: candidate.displayName,
        badge: candidate.changedFileCount > 0 ? (zh ? '进行中' : 'Active') : (zh ? '项目' : 'Project'),
        meta: candidate.branch
          ? `${candidate.branch}${candidate.changedFileCount > 0 ? (zh ? ` · ${candidate.changedFileCount} 处改动` : ` · ${candidate.changedFileCount} changes`) : ''}`
          : compactPath(candidate.rootPath),
        primary: cards.length === 0,
        actionPrompt: zh
          ? `请只读了解目录 ${candidate.rootPath} 的现状，用 3 句话总结当前进度，并给出我现在最值得先做的 1 个具体下一步。`
          : `Inspect ${candidate.rootPath} (read-only), summarize where things stand in 3 crisp sentences, and recommend the best next step right now.`,
        priorityTitle: candidate.displayName,
        rootPath: candidate.rootPath,
      });
    }
  }

  if (cards.length === 0 && recentFileCount > 0) {
    cards.push({
      id: 'thread:recent-synthesis',
      kind: 'thread',
      title: zh ? '梳理近期文件与下一步' : 'Synthesize recent files & next steps',
      badge: zh ? '当下' : 'Now',
      meta: zh ? `${recentFileCount} 份文档` : `${recentFileCount} docs`,
      primary: true,
      actionPrompt: zh
        ? '结合你刚刚从我本机近期文档中了解到的脉络，帮我整理出今天最值得优先推进的 2 件事，并直接开启第一件。'
        : 'Based on the context you just gathered from my recent local files, prioritize the top 2 things I should push forward today and start the first one.',
      priorityTitle: zh ? '梳理近期文件与下一步' : 'Synthesize recent files',
    });
  }

  return cards;
}

export function buildThreadCardsFromFolderRun(
  run: WorkDiscoveryRun,
  estimatedMinutesTemplate: string,
  zh: boolean,
): ThreadCard[] {
  const result = run.result;
  if (!result) return [];
  const primary = result.suggestions.find((item) => item.id === result.primarySuggestionId)
    ?? result.suggestions[0];
  const ordered = [
    ...(primary ? [primary] : []),
    ...result.suggestions.filter((item) => item.id !== primary?.id),
  ];

  const cards: ThreadCard[] = ordered.slice(0, 3).map((suggestion, index) => ({
    id: `suggestion:${suggestion.id}`,
    kind: 'suggestion',
    title: suggestion.title,
    badge: index === 0 ? (zh ? '推荐第一步' : 'Recommended') : undefined,
    meta: suggestion.estimatedMinutes
      ? estimatedMinutesTemplate.replace('{{count}}', String(suggestion.estimatedMinutes))
      : undefined,
    primary: index === 0,
    actionPrompt: suggestion.actionPrompt,
    priorityTitle: suggestion.title,
    conversationId: run.conversationId,
    suggestion,
  }));

  if (cards.length < 3 && result.workThreads?.length) {
    for (const thread of result.workThreads) {
      if (cards.length >= 3) break;
      if (cards.some((card) => card.title === thread.title)) continue;
      cards.push({
        id: `run-thread:${thread.id}`,
        kind: 'thread',
        title: thread.title,
        badge: horizonLabel(thread.horizon, zh),
        actionPrompt: zh
          ? `在当前项目中围绕「${thread.title}」推进下一步：${thread.summary}`
          : `Move forward on "${thread.title}" in this project: ${thread.summary}`,
        priorityTitle: thread.title,
        conversationId: run.conversationId,
      });
    }
  }

  return cards;
}

export function collectRevealEvidence(
  run: WorkDiscoveryRun | null,
  localItems: Array<{ title: string; group?: string }>,
): RevealEvidenceItem[] {
  const items: RevealEvidenceItem[] = [];
  if (run?.result) {
    const primary = run.result.suggestions.find((s) => s.id === run.result?.primarySuggestionId)
      ?? run.result.suggestions[0];
    if (primary?.evidence.length) {
      items.push(...primary.evidence.slice(0, 3));
    }
  }
  for (const doc of localItems.slice(0, 4)) {
    items.push({
      path: doc.title,
      observation: doc.group ?? '',
    });
  }
  return items.slice(0, 5);
}
