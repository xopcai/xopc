export type ConnectorIdentityProbe = {
  actionId: string;
};

export type ConnectorLearningStream = {
  scope: string;
  actionId: string;
  arguments: Record<string, unknown>;
  kind: 'activity' | 'inventory';
};

export type ConnectorLearningPlan = {
  toolkit: string;
  identityProbe?: ConnectorIdentityProbe;
  streams: ConnectorLearningStream[];
  bootstrapWindowDays: number;
  intervalMinutes: number;
};

export function buildConnectorLearningArguments(
  plan: ConnectorLearningPlan,
  stream: ConnectorLearningStream,
  input: { cursor?: string; windowStart?: string },
  identity: Record<string, unknown>,
): Record<string, unknown> {
  if (plan.toolkit === 'github' && stream.scope === 'authored-work') {
    const username = typeof identity.username === 'string' ? identity.username.trim() : '';
    if (!username) throw new Error('GitHub activity sync requires the authenticated username.');
    return { ...stream.arguments, q: `author:${username} sort:updated-desc` };
  }
  if (!input.cursor) return { ...stream.arguments };
  if (plan.toolkit === 'gmail') {
    const after = Math.floor(Date.parse(input.cursor) / 1_000);
    return Number.isFinite(after)
      ? { ...stream.arguments, query: `after:${after} -in:spam -in:trash` }
      : { ...stream.arguments };
  }
  if (plan.toolkit === 'googlecalendar') {
    return { ...stream.arguments, time_min: input.cursor };
  }
  return { ...stream.arguments };
}

const PLANS: Record<string, ConnectorLearningPlan> = {
  gmail: {
    toolkit: 'gmail',
    identityProbe: { actionId: 'GMAIL_GET_PROFILE' },
    streams: [{
      scope: 'messages', actionId: 'GMAIL_FETCH_EMAILS', kind: 'activity',
      arguments: { max_results: 100, query: 'newer_than:30d -in:spam -in:trash' },
    }],
    bootstrapWindowDays: 30,
    intervalMinutes: 15,
  },
  googlecalendar: {
    toolkit: 'googlecalendar',
    streams: [{
      scope: 'events', actionId: 'GOOGLECALENDAR_LIST_EVENTS', kind: 'activity', arguments: { max_results: 200 },
    }],
    bootstrapWindowDays: 90,
    intervalMinutes: 15,
  },
  googledrive: {
    toolkit: 'googledrive',
    streams: [{ scope: 'files', actionId: 'GOOGLEDRIVE_SEARCH_FILES', kind: 'inventory', arguments: {} }],
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  notion: {
    toolkit: 'notion',
    streams: [{ scope: 'pages', actionId: 'NOTION_SEARCH', kind: 'inventory', arguments: {} }],
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  slack: {
    toolkit: 'slack',
    streams: [{ scope: 'channels', actionId: 'SLACK_LIST_CHANNELS', kind: 'inventory', arguments: {} }],
    bootstrapWindowDays: 30,
    intervalMinutes: 15,
  },
  github: {
    toolkit: 'github',
    identityProbe: { actionId: 'GITHUB_GET_THE_AUTHENTICATED_USER' },
    streams: [
      {
        scope: 'repositories', actionId: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
        kind: 'inventory', arguments: {},
      },
      {
        scope: 'authored-work', actionId: 'GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS',
        kind: 'activity', arguments: { per_page: 100 },
      },
    ],
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  linear: {
    toolkit: 'linear',
    streams: [{ scope: 'issues', actionId: 'LINEAR_LIST_ISSUES', kind: 'activity', arguments: {} }],
    bootstrapWindowDays: 60,
    intervalMinutes: 15,
  },
};

export function getConnectorLearningPlan(toolkit: string): ConnectorLearningPlan | undefined {
  return PLANS[toolkit.trim().toLowerCase()];
}

export function listConnectorLearningPlans(): ConnectorLearningPlan[] {
  return Object.values(PLANS);
}
