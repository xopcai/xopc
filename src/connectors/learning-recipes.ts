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
  if (plan.toolkit === 'github' && stream.scope === 'authored-work') {
    const username = typeof identity.username === 'string' ? identity.username.trim() : '';
    if (!username) throw new Error('GitHub activity sync requires the authenticated username.');
    return { ...stream.arguments, q: `author:${username} sort:updated-desc` };
  }
  if (plan.toolkit === 'gmail') {
    const after = cursor?.checkpoint ? Math.floor(Date.parse(cursor.checkpoint) / 1_000) : Number.NaN;
    return {
      ...stream.arguments,
      ...(Number.isFinite(after) ? { query: `after:${after} -in:spam -in:trash` } : {}),
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
    streams: [{
      scope: 'messages', actionId: 'GMAIL_FETCH_EMAILS', kind: 'activity',
      arguments: {
        max_results: 30,
        include_payload: true,
        verbose: false,
        query: 'newer_than:30d -in:spam -in:trash',
      },
    }],
    bootstrapWindowDays: 30,
    intervalMinutes: 15,
  },
  googlecalendar: {
    toolkit: 'googlecalendar',
    streams: [{
      scope: 'events', actionId: 'GOOGLECALENDAR_SYNC_EVENTS', kind: 'activity', arguments: { max_results: 500 },
    }],
    bootstrapWindowDays: 90,
    intervalMinutes: 15,
  },
  googledrive: {
    toolkit: 'googledrive',
    identityProbe: { actionId: 'GOOGLEDRIVE_GET_ABOUT' },
    streams: [{
      scope: 'files', actionId: 'GOOGLEDRIVE_FIND_FILE', kind: 'inventory',
      arguments: {
        q: 'trashed = false',
        orderBy: 'modifiedTime desc',
        pageSize: 100,
        fields: 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,owners,webViewLink,trashed)',
      },
    }],
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
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
