import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';

import { getConnectorDefinition } from '../../connectors/catalog.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { normalizeConnectedSourceResult } from '../../connectors/connected-source-normalizers.js';
import { sanitizeConnectedSourceValue } from '../../connectors/connected-source-sanitization.js';
import { sceneContentHash, type SceneActivation, type ScenePrincipal } from '../../scenes/contracts.js';
import type { SceneContextProvider, SceneEvidence } from '../../scenes/execution.js';
import { SceneMailContextProvider } from '../../scenes/mailContext.js';
import { SceneSourceNotReady, sceneSourceFailureReason } from '../../scenes/readiness.js';
import { getConnectorConnection, getConnectorInstallation } from '../../storage/sqlite/connector-repository.js';

const ACTION = 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reads only the delegated thread; never starts mailbox learning or persists raw mail. */
export class GatewaySceneMailContext extends SceneMailContextProvider {
  constructor(private readonly connectionDb: DatabaseSync, private readonly now: () => number = Date.now,
    private readonly adapter: Pick<ComposioSessionsAdapter, 'executeWithPolicy'> = new ComposioSessionsAdapter()) {
    super(connectionDb, now);
  }

  private recordRequest(principal: ScenePrincipal, accountId: string): void {
    this.connectionDb.prepare(`INSERT INTO scene_connector_usage VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(owner_id, workspace_id, account_id, utc_day) DO UPDATE SET request_count = request_count + 1`)
      .run(principal.ownerId, principal.workspaceId, accountId, Math.floor(this.now() / 86400000));
  }

  listAccounts(principal: ScenePrincipal): Array<{ id: string; label: string }> {
    return this.connectionDb.prepare(`SELECT a.id, a.label, a.identity_json, c.connector_id FROM connector_accounts a
      JOIN connector_connections c ON c.id = a.current_connection_id AND c.account_id = a.id
        AND c.principal_id = a.principal_id AND c.connector_id = a.connector_id
      JOIN connector_installations i ON i.id = c.installation_id AND i.principal_id = a.principal_id AND i.connector_id = a.connector_id
      WHERE a.principal_id = ? AND a.enabled = 1 AND c.status = 'active' AND c.provider = 'composio'
        AND i.enabled = 1 AND i.confirmation_policy <> 'always'
        AND json_array_length(i.allowed_agent_ids_json) = 0 AND a.allowed_agent_ids_json IS NULL
        AND (i.selected_account_ids_json = 'null' OR EXISTS (SELECT 1 FROM json_each(i.selected_account_ids_json) WHERE value = a.id))
        AND (c.expires_at IS NULL OR julianday(c.expires_at) > julianday(?, 'unixepoch')) ORDER BY a.id LIMIT 100`)
      .all(principal.ownerId, this.now() / 1000).filter(row => {
        const definition = getConnectorDefinition(String(row.connector_id));
        return definition?.runtime.type === 'composio' && definition.runtime.toolkit === 'gmail';
      }).map(row => {
        const identity = record(JSON.parse(String(row.identity_json)));
        return { id: String(row.id), label: String(row.label || identity.email || identity.name || row.id).slice(0, 300) };
      });
  }

  override authorizedAccounts(activation: SceneActivation): string[] {
    if (activation.scope.kind !== 'objects' || activation.scope.ids.length !== 1) return [];
    const source = this.connectionDb.prepare('SELECT account_id FROM scene_mail_sources WHERE id = ? AND owner_id = ? AND workspace_id = ?')
      .get(activation.scope.ids[0], activation.ownerId, activation.workspaceId);
    return source && activation.permissions.accountIds.includes(String(source.account_id))
      && this.listAccounts(activation).some(account => account.id === source.account_id) ? [String(source.account_id)] : [];
  }

  override listSources(principal: ScenePrincipal, limit = 50, afterId = '') {
    const accounts = new Set(this.listAccounts(principal).map(account => account.id));
    return this.connectionDb.prepare('SELECT id, account_id, subject, sender FROM scene_mail_sources WHERE owner_id = ? AND workspace_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(principal.ownerId, principal.workspaceId, afterId, limit).filter(row => accounts.has(String(row.account_id)))
      .map(row => ({ id: String(row.id), accountId: String(row.account_id), subject: String(row.subject), sender: String(row.sender) }));
  }

  async searchSources(principal: ScenePrincipal, value: unknown, signal: AbortSignal) {
    const { accountId, query } = z.strictObject({ accountId: z.string().min(1).max(200), query: z.string().trim().min(1).max(500) }).parse(value);
    if (!this.listAccounts(principal).some(account => account.id === accountId)) throw new Error('Mail account is not available for scene reads');
    const account = this.connectionDb.prepare('SELECT current_connection_id FROM connector_accounts WHERE id = ?').get(accountId)!;
    const connection = getConnectorConnection(String(account.current_connection_id))!;
    const installation = getConnectorInstallation(connection.installationId!)!;
    signal.throwIfAborted();
    this.recordRequest(principal, accountId);
    const response = await this.adapter.executeWithPolicy({ context: { principalId: principal.ownerId, toolkits: ['gmail'] }, connection, installation, signal,
      action: { connectorId: connection.connectorId, toolkit: 'gmail', actionId: 'GMAIL_FETCH_EMAILS', scope: 'read', curated: true, cachedAt: new Date(this.now()).toISOString() },
      args: { query: `(${query}) -in:spam -in:trash -in:drafts`, max_results: 30, include_payload: true, verbose: false } });
    signal.throwIfAborted();
    if (response.decision !== 'allowed') throw new Error('Mail search permission is required');
    const envelope = record(response.result);
    if (envelope.successful === false || envelope.error || !Array.isArray(record(envelope.data).messages)) throw new SceneSourceNotReady();
    if (!this.listAccounts(principal).some(account => account.id === accountId)
      || this.connectionDb.prepare('SELECT current_connection_id FROM connector_accounts WHERE id = ?').get(accountId)?.current_connection_id !== connection.id) throw new Error('Mail authorization changed');
    const normalized = normalizeConnectedSourceResult({ toolkit: 'gmail', actionId: 'GMAIL_FETCH_EMAILS', result: envelope.data });
    const sources = new Map<string, { id: string; accountId: string; subject: string; sender: string }>();
    for (const mail of normalized.slice(0, 30)) {
      const threadId = mail.value.threadId;
      if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > 200) continue;
      if (Array.isArray(mail.value.labels) && mail.value.labels.some(label => ['DRAFT', 'TRASH', 'SPAM'].includes(String(label)))) continue;
      const id = createHash('sha256').update(JSON.stringify([principal.ownerId, principal.workspaceId, accountId, threadId])).digest('hex');
      const subject = String(mail.value.subject ?? '').slice(0, 300);
      const sender = String(mail.value.sender ?? '').slice(0, 300);
      this.connectionDb.prepare(`INSERT INTO scene_mail_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, sender = excluded.sender, selected_at = excluded.selected_at`)
        .run(id, principal.ownerId, principal.workspaceId, accountId, threadId, subject, sender, this.now());
      sources.set(id, { id, accountId, subject, sender });
    }
    return [...sources.values()];
  }

  private source(subjectId: string): { connectionId: string; threadId: string } {
    const row = this.connectionDb.prepare(`SELECT a.current_connection_id, s.thread_id FROM scene_mail_sources s
      JOIN connector_accounts a ON a.id = s.account_id WHERE s.id = ?`).get(subjectId);
    if (!row) throw new Error('Mail source unavailable');
    return { connectionId: String(row.current_connection_id), threadId: String(row.thread_id) };
  }

  override async read(input: Parameters<SceneContextProvider['read']>[0]): Promise<SceneEvidence[]> {
    input.signal.throwIfAborted();
    const accounts = this.authorizedAccounts(input.activation);
    if (!input.permissions.contextProviders.includes('mail') || accounts.length !== 1 || !input.permissions.accountIds.includes(accounts[0])
      || input.activation.scope.kind !== 'objects' || input.activation.scope.ids[0] !== input.subjectId) throw new Error('Mail permission is required');
    const origin = this.source(input.subjectId);
    const startedAt = this.now();
    if (input.notBefore !== undefined && startedAt < input.notBefore) throw new SceneSourceNotReady();
    const connection = getConnectorConnection(origin.connectionId)!;
    const installation = getConnectorInstallation(connection.installationId!)!;
    const messages: Record<string, unknown>[] = [];
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      input.signal.throwIfAborted();
      if (!this.authorizedAccounts(input.activation).includes(accounts[0]) || sceneContentHash(this.source(input.subjectId)) !== sceneContentHash(origin)) {
        throw new Error('Mail permission changed');
      }
      let response: Awaited<ReturnType<ComposioSessionsAdapter['executeWithPolicy']>>;
      try {
        this.recordRequest(input.activation, accounts[0]);
        response = await this.adapter.executeWithPolicy({ context: { principalId: input.activation.ownerId, toolkits: ['gmail'] },
          connection, installation, signal: input.signal,
          action: { connectorId: connection.connectorId, toolkit: 'gmail', actionId: ACTION, scope: 'read', curated: true, cachedAt: new Date(startedAt).toISOString() },
          args: { user_id: 'me', thread_id: origin.threadId, ...(pageToken ? { page_token: pageToken } : {}) } });
      } catch (error) {
        input.signal.throwIfAborted();
        throw new SceneSourceNotReady(sceneSourceFailureReason(error));
      }
      input.signal.throwIfAborted();
      if (response.decision !== 'allowed') throw new Error('Mail connector permission is required');
      const envelope = record(response.result);
      const data = record(envelope.data);
      if (envelope.successful === false || envelope.error || !Array.isArray(data.messages) || data.messages.some(message => !message || typeof message !== 'object')) {
        throw new SceneSourceNotReady(sceneSourceFailureReason(envelope.error));
      }
      messages.push(...data.messages.map(record));
      if (messages.length > 30 || JSON.stringify(messages).length > 500_000) throw new Error('Mail thread exceeds its context budget');
      if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') throw new SceneSourceNotReady();
      pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined;
      if (pageToken) {
        if (!data.messages.length || tokens.has(pageToken) || tokens.size >= 29) throw new SceneSourceNotReady();
        tokens.add(pageToken);
      }
    } while (pageToken);
    if (!this.authorizedAccounts(input.activation).includes(accounts[0]) || sceneContentHash(this.source(input.subjectId)) !== sceneContentHash(origin)) throw new Error('Mail permission changed');
    if (messages.some(message => message.threadId !== origin.threadId || !Array.isArray(message.labelIds))) throw new SceneSourceNotReady();
    const normalized = normalizeConnectedSourceResult({ toolkit: 'gmail', actionId: ACTION, result: { messages } });
    if (normalized.length !== messages.length || new Set(normalized.map(message => message.externalId)).size !== messages.length) throw new SceneSourceNotReady();
    const active = normalized.filter(message => !(message.value.labels as unknown[]).some(label => ['DRAFT', 'TRASH', 'SPAM'].includes(String(label))));
    if (!active.length || active.some(message => typeof message.value.content !== 'string' || !message.value.content.trim())) throw new SceneSourceNotReady();
    const evidence = active.map(message => {
      const content = JSON.stringify(sanitizeConnectedSourceValue(message.value));
      return { id: `mail:${accounts[0]}:${message.externalId}`, subjectId: input.subjectId,
        ownerId: input.activation.ownerId, workspaceId: input.activation.workspaceId, accountId: accounts[0],
        content, revision: sceneContentHash(content), freshUntil: startedAt + 30 * 60_000,
        ...(message.occurredAt ? { occurredAt: Date.parse(message.occurredAt) } : {}) };
    });
    if (evidence.reduce((size, message) => size + message.content.length, 0) > 120_000) throw new Error('Mail thread exceeds its context budget');
    return evidence;
  }
}
