import type { ConnectorDefinition } from './types.js';
import { decodeConnectedSourceCursor } from './connected-source-cursor.js';

export type ConnectorIdentityProbe = {
  actionId: string;
};

export type ConnectorLearningStream = {
  scope: string;
  actionId: string;
  arguments: Record<string, unknown>;
  kind: 'activity' | 'inventory';
  maxItems?: number;
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
  const cursor = decodeConnectedSourceCursor(input.cursor);
  if (plan.toolkit === 'github' && (stream.scope === 'authored-work' || stream.scope === 'reviewed-work')) {
    const username = typeof identity.username === 'string' ? identity.username.trim() : '';
    if (!username) throw new Error('GitHub activity sync requires the authenticated username.');
    const q = stream.scope === 'reviewed-work'
      ? `reviewed-by:${username} -author:${username} sort:updated-desc`
      : `author:${username} sort:updated-desc`;
    return { ...stream.arguments, q };
  }
  if (plan.toolkit === 'gmail') {
    const after = cursor?.checkpoint ? Math.floor(Date.parse(cursor.checkpoint) / 1_000) : Number.NaN;
    const baseQuery = typeof stream.arguments.query === 'string' ? stream.arguments.query.trim() : '';
    const incrementalQuery = Number.isFinite(after) ? `after:${after}` : '';
    return {
      ...stream.arguments,
      ...((baseQuery || incrementalQuery)
        ? { query: [baseQuery, incrementalQuery, '-in:spam', '-in:trash'].filter(Boolean).join(' ') }
        : {}),
      ...(cursor?.pageToken ? { page_token: cursor.pageToken } : {}),
    };
  }
  if (plan.toolkit === 'googlecalendar') {
    return {
      ...stream.arguments,
      ...(cursor?.syncToken ? { sync_token: cursor.syncToken } : {}),
      ...(cursor?.pageToken ? { page_token: cursor.pageToken } : {}),
    };
  }
  if (plan.toolkit === 'googledrive') {
    const checkpoint = cursor?.checkpoint && Number.isFinite(Date.parse(cursor.checkpoint))
      ? cursor.checkpoint
      : undefined;
    const baseQuery = typeof stream.arguments.q === 'string' ? stream.arguments.q : '';
    return {
      ...stream.arguments,
      ...(checkpoint ? { q: [baseQuery, `modifiedTime > '${checkpoint}'`].filter(Boolean).join(' and ') } : {}),
      ...(cursor?.pageToken ? { pageToken: cursor.pageToken } : {}),
    };
  }
  return { ...stream.arguments };
}

const PLANS: Record<string, ConnectorLearningPlan> = {
  gmail: {
    toolkit: 'gmail',
    identityProbe: { actionId: 'GMAIL_GET_PROFILE' },
    streams: [
      {
        scope: 'sent-messages', actionId: 'GMAIL_FETCH_EMAILS', kind: 'activity', maxItems: 200,
        arguments: { max_results: 50, include_payload: true, verbose: false, query: 'in:sent newer_than:180d' },
      },
      {
        scope: 'messages', actionId: 'GMAIL_FETCH_EMAILS', kind: 'activity', maxItems: 150,
        arguments: {
          max_results: 50,
          include_payload: true,
          verbose: false,
          query: 'newer_than:90d -in:sent -category:promotions -category:social -category:forums',
        },
      },
    ],
    bootstrapWindowDays: 180,
    intervalMinutes: 15,
  },
  googlecalendar: {
    toolkit: 'googlecalendar',
    streams: [{
      scope: 'events', actionId: 'GOOGLECALENDAR_SYNC_EVENTS', kind: 'activity', maxItems: 1_000,
      arguments: { max_results: 500 },
    }],
    bootstrapWindowDays: 180,
    intervalMinutes: 15,
  },
  googledrive: {
    toolkit: 'googledrive',
    identityProbe: { actionId: 'GOOGLEDRIVE_GET_ABOUT' },
    streams: [{
      scope: 'files', actionId: 'GOOGLEDRIVE_FIND_FILE', kind: 'inventory', maxItems: 300,
      arguments: {
        q: 'trashed = false',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        fields: 'nextPageToken,files(id,name,mimeType,description,createdTime,modifiedTime,owners,webViewLink,trashed)',
      },
    }],
    bootstrapWindowDays: 180,
    intervalMinutes: 30,
  },
  github: {
    toolkit: 'github',
    identityProbe: { actionId: 'GITHUB_GET_THE_AUTHENTICATED_USER' },
    streams: [
      {
        scope: 'repositories', actionId: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
        kind: 'inventory', maxItems: 200, arguments: {},
      },
      {
        scope: 'authored-work', actionId: 'GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS',
        kind: 'activity', maxItems: 150, arguments: { per_page: 100 },
      },
      {
        scope: 'reviewed-work', actionId: 'GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS',
        kind: 'activity', maxItems: 100, arguments: { per_page: 100 },
      },
    ],
    bootstrapWindowDays: 180,
    intervalMinutes: 30,
  },
  linear: {
    toolkit: 'linear',
    streams: [{ scope: 'issues', actionId: 'LINEAR_LIST_ISSUES', kind: 'activity', maxItems: 200, arguments: {} }],
    bootstrapWindowDays: 120,
    intervalMinutes: 15,
  },
};

export function getConnectorLearningPlan(toolkit: string): ConnectorLearningPlan | undefined {
  return PLANS[toolkit.trim().toLowerCase()];
}

export function connectorUnderstandingCapability(
  toolkit: string,
): ConnectorDefinition['understanding'] | undefined {
  const plan = getConnectorLearningPlan(toolkit);
  if (!plan) return undefined;
  return {
    mode: plan.streams.some((stream) => stream.kind === 'activity') ? 'activity' : 'inventory',
    bootstrapWindowDays: plan.bootstrapWindowDays,
    readOnly: true,
  };
}

export function listConnectorLearningPlans(): ConnectorLearningPlan[] {
  return Object.values(PLANS);
}
