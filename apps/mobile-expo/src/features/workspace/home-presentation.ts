export type HomeContinueCandidate<T> = {
  value: T;
  id: string;
  kind: 'active_chat' | 'running_work' | 'recent_chat' | 'note';
  updatedAt: number;
};

const RECENT_USER_ACTIVITY_MS = 24 * 60 * 60 * 1_000;

function continueTier<T>(candidate: HomeContinueCandidate<T>, nowMs: number): number {
  const userOpened = candidate.kind === 'recent_chat' || candidate.kind === 'note';
  if (userOpened && nowMs - candidate.updatedAt <= RECENT_USER_ACTIVITY_MS) return 4;
  if (candidate.kind === 'active_chat') return 3;
  if (candidate.kind === 'running_work') return 2;
  return 1;
}

export function rankHomeContinueCandidates<T>(
  candidates: HomeContinueCandidate<T>[],
  focusedId: string | undefined,
  nowMs = Date.now(),
): T[] {
  return candidates
    .filter((candidate) => candidate.id !== focusedId)
    .sort((left, right) => (
      continueTier(right, nowMs) - continueTier(left, nowMs)
      || right.updatedAt - left.updatedAt
    ))
    .map((candidate) => candidate.value);
}

export function mobileRouteForHomeHref(href: string): string {
  const url = new URL(href, 'https://xopc.local');
  const taskMatch = /^\/tasks\/([^/]+)$/.exec(url.pathname);
  if (taskMatch) return `/tasks/${taskMatch[1]}`;
  const chatMatch = /^\/chat\/([^/]+)$/.exec(url.pathname);
  if (chatMatch) return `/chat/${chatMatch[1]}`;
  if (url.pathname === '/workflows') {
    const runId = url.searchParams.get('runId');
    return runId ? `/workflows/runs/${encodeURIComponent(runId)}` : '/workflows';
  }
  if (url.pathname === '/automations') {
    const runId = url.searchParams.get('run');
    if (runId) return `/automation/runs/${encodeURIComponent(runId)}`;
    const automationId = url.searchParams.get('automation');
    return automationId ? `/automation/${encodeURIComponent(automationId)}` : '/automation';
  }
  if (url.pathname === '/notes' && url.searchParams.get('status') === 'inbox') return '/inbox';
  if (url.pathname === '/connectors') return '/settings';
  return `${url.pathname}${url.search}`;
}
