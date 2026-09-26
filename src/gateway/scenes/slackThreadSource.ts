import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import { getConnectorDefinition } from '../../connectors/catalog.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { sanitizeConnectedSourceValue } from '../../connectors/connected-source-sanitization.js';
import { getConnectorConnection, getConnectorInstallation } from '../../storage/sqlite/connector-repository.js';
import { sceneContentHash, type ScenePrincipal } from '../../scenes/contracts.js';
import type { SceneSourceAdapter, SourceSnapshot } from '../../scenes/taskFollowUp/contracts.js';

export const slackThreadSchema = z.strictObject({ accountId: z.string().min(1).max(200), teamId: z.string().regex(/^T[A-Z0-9]+$/),
  channelId: z.string().regex(/^[CDG][A-Z0-9]+$/), threadTs: z.string().regex(/^\d{10,}\.\d{6}$/) });
export type SlackThread = z.infer<typeof slackThreadSchema>;

/** Parse locally; never fetch a user-supplied URL. Reply links resolve to their root. */
export function parseSlackThreadUrl(value: string): { channelId: string; threadTs: string } {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new Error('Expected a Slack message link');
  const match = /^\/archives\/([CDG][A-Z0-9]+)\/p(\d{16,})$/.exec(url.pathname);
  if (!match) throw new Error('Expected a Slack message link');
  const threadTs = url.searchParams.get('thread_ts') ?? `${match[2].slice(0, -6)}.${match[2].slice(-6)}`;
  if (!/^\d{10,}\.\d{6}$/.test(threadTs)) throw new Error('Invalid Slack thread timestamp');
  return { channelId: match[1], threadTs };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Read-only connector adapter. Account policy is rechecked before and after every page. */
export class SlackThreadSource implements SceneSourceAdapter {
  readonly id = 'slack_thread';
  readonly label = 'Slack thread';
  normalize(reference: Record<string, string>) { return slackThreadSchema.parse(reference); }
  accountIds(reference: Record<string, string>) { return [this.normalize(reference).accountId]; }
  authorized(principal: ScenePrincipal, reference: Record<string, string>) {
    return this.listAccounts(principal).some(account => account.id === this.normalize(reference).accountId);
  }
  constructor(private readonly db: DatabaseSync,
    private readonly adapter: Pick<ComposioSessionsAdapter, 'executeWithPolicy'> = new ComposioSessionsAdapter()) {}

  listAccounts(principal: ScenePrincipal): Array<{ id: string; label: string }> {
    return this.db.prepare(`SELECT a.id, a.label, c.connector_id FROM connector_accounts a
      JOIN connector_connections c ON c.id = a.current_connection_id AND c.account_id = a.id
        AND c.principal_id = a.principal_id AND c.connector_id = a.connector_id
      JOIN connector_installations i ON i.id = c.installation_id AND i.principal_id = a.principal_id AND i.connector_id = a.connector_id
      WHERE a.principal_id = ? AND a.enabled = 1 AND c.status = 'active' AND c.provider = 'composio'
        AND i.enabled = 1 AND i.confirmation_policy <> 'always'
        AND json_array_length(i.allowed_agent_ids_json) = 0 AND a.allowed_agent_ids_json IS NULL
        AND (i.selected_account_ids_json = 'null' OR EXISTS (SELECT 1 FROM json_each(i.selected_account_ids_json) WHERE value = a.id))
        AND (c.expires_at IS NULL OR julianday(c.expires_at) > julianday('now')) ORDER BY a.id LIMIT 100`)
      .all(principal.ownerId).filter(row => {
        const definition = getConnectorDefinition(String(row.connector_id));
        return definition?.runtime.type === 'composio' && definition.runtime.toolkit === 'slack';
      }).map(row => ({ id: String(row.id), label: String(row.label || row.id).slice(0, 300) }));
  }

  private connection(principal: ScenePrincipal, accountId: string) {
    if (!this.listAccounts(principal).some(account => account.id === accountId)) throw new Error('Slack account permission unavailable');
    const row = this.db.prepare('SELECT current_connection_id FROM connector_accounts WHERE id = ?').get(accountId)!;
    return getConnectorConnection(String(row.current_connection_id))!;
  }

  private async call(principal: ScenePrincipal, accountId: string, actionId: string, args: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    const connection = this.connection(principal, accountId);
    const installation = getConnectorInstallation(connection.installationId!)!;
    const day = Math.floor(Date.now() / 86400000);
    const usage = this.db.prepare('SELECT request_count FROM scene_connector_usage WHERE owner_id = ? AND workspace_id = ? AND account_id = ? AND utc_day = ?')
      .get(principal.ownerId, principal.workspaceId, accountId, day);
    if (Number(usage?.request_count ?? 0) >= 3000) throw new Error('Slack daily request budget exhausted');
    this.db.prepare(`INSERT INTO scene_connector_usage VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(owner_id, workspace_id, account_id, utc_day) DO UPDATE SET request_count = request_count + 1`)
      .run(principal.ownerId, principal.workspaceId, accountId, day);
    const result = await this.adapter.executeWithPolicy({ context: { principalId: principal.ownerId, toolkits: ['slack'] },
      connection, installation, signal, args,
      action: { connectorId: connection.connectorId, toolkit: 'slack', actionId, scope: 'read', curated: true, cachedAt: new Date().toISOString() } });
    signal.throwIfAborted();
    if (this.connection(principal, accountId).id !== connection.id) throw new Error('Slack connection changed');
    if (result.decision !== 'allowed') throw new Error('Slack read requires permission');
    const envelope = object(result.result);
    const data = object(envelope.data);
    if (envelope.successful === false || envelope.error || data.ok === false || data.error || !Object.keys(data).length) throw new Error('Slack source unavailable; check connection permissions or rate limit');
    return data;
  }

  async resolveLink(principal: ScenePrincipal, accountId: string, url: string, signal: AbortSignal): Promise<SlackThread> {
    const parsed = parseSlackThreadUrl(url);
    const auth = await this.call(principal, accountId, 'SLACK_TEST_AUTH', {}, signal);
    if (typeof auth.team_id !== 'string' || !/^T[A-Z0-9]+$/.test(auth.team_id)) throw new Error('Slack workspace identity unavailable');
    return { accountId, teamId: auth.team_id, ...parsed };
  }

  async read(principal: ScenePrincipal, reference: Record<string, string>, signal: AbortSignal): Promise<SourceSnapshot> {
    const thread = this.normalize(reference);
    const auth = await this.call(principal, thread.accountId, 'SLACK_TEST_AUTH', {}, signal);
    if (auth.team_id !== thread.teamId) throw new Error('Slack workspace identity changed');
    const messages = new Map<string, { ts: string; user: string; text: string; unreadAttachments?: unknown }>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const data = await this.call(principal, thread.accountId, 'SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION',
        { channel: thread.channelId, ts: thread.threadTs, limit: 100, ...(cursor ? { cursor } : {}) }, signal);
      if (!Array.isArray(data.messages) || !data.messages.length) throw new Error('Slack thread is missing or incomplete');
      for (const item of data.messages) {
        const message = object(item);
        if (typeof message.ts !== 'string' || typeof message.text !== 'string'
          || (message.ts !== thread.threadTs && message.thread_ts !== thread.threadTs)) throw new Error('Unexpected Slack thread response');
        messages.set(message.ts, { ts: message.ts, user: String(message.user ?? message.bot_id ?? 'unknown'),
          text: String(sanitizeConnectedSourceValue(message.text)),
          ...((Array.isArray(message.files) && message.files.length) || (Array.isArray(message.attachments) && message.attachments.length)
            ? { unreadAttachments: sanitizeConnectedSourceValue({
              files: Array.isArray(message.files) ? message.files.slice(0, 20).map(value => {
                const file = object(value); return { id: file.id, name: file.name, mimetype: file.mimetype };
              }) : [],
              richMessageCount: Array.isArray(message.attachments) ? message.attachments.length : 0,
              contentFetched: false,
            }) } : {}) });
      }
      if (messages.size > 200) throw new Error('Slack thread exceeds the 200-message context budget');
      const next = object(data.response_metadata).next_cursor;
      if (next != null && typeof next !== 'string') throw new Error('Invalid Slack pagination');
      cursor = typeof next === 'string' && next.trim() ? next.trim() : undefined;
      if (data.has_more === true && !cursor) throw new Error('Slack thread pagination is incomplete');
      if (cursor && (cursors.has(cursor) || cursors.size >= 9)) throw new Error('Slack pagination budget exceeded');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (!messages.has(thread.threadTs)) throw new Error('Select the root of the Slack thread');
    const ordered = [...messages.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    const text = JSON.stringify(ordered);
    if (text.length > 32_000) throw new Error('Slack thread exceeds the 32,000-character context budget');
    return { revision: sceneContentHash(ordered), text, observedAt: Date.now() };
  }
}
