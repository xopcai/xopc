export function mobileRouteForWorkbenchHref(href: string): string {
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
