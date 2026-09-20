import type { DatabaseSync } from 'node:sqlite';

import { getConnectorDefinition } from '../../connectors/catalog.js';
import { ComposioSessionsAdapter } from '../../connectors/composio-sessions.js';
import { normalizeConnectedSourceResult } from '../../connectors/connected-source-normalizers.js';
import { sanitizeConnectedSourceValue } from '../../connectors/connected-source-sanitization.js';
import { sceneContentHash, type SceneActivation } from '../../scenes/contracts.js';
import type { SceneContextProvider, SceneEvidence } from '../../scenes/execution.js';
import { SceneMailContextProvider } from '../../scenes/mailContext.js';
import { SceneSourceNotReady } from '../../scenes/readiness.js';
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

  override authorizedAccounts(activation: SceneActivation): string[] {
    const accounts = super.authorizedAccounts(activation);
    if (!accounts.length || activation.scope.kind !== 'objects') return [];
    const { connectionId } = this.source(activation.scope.ids[0]);
    const connection = getConnectorConnection(connectionId);
    const installation = connection?.installationId ? getConnectorInstallation(connection.installationId) : undefined;
    const definition = connection ? getConnectorDefinition(connection.connectorId) : undefined;
    return connection?.provider === 'composio' && installation?.confirmationPolicy !== 'always'
      && definition?.runtime.type === 'composio' && definition.runtime.toolkit === 'gmail' ? accounts : [];
  }

  private source(subjectId: string): { connectionId: string; threadId: string } {
    const row = this.connectionDb.prepare('SELECT metadata_json, normalized_text FROM knowledge_source_items WHERE item_id = ? AND deleted_at IS NULL').get(subjectId);
    if (!row) throw new Error('Mail source unavailable');
    const metadata = record(JSON.parse(String(row.metadata_json)));
    const fields = record(JSON.parse(String(row.normalized_text)));
    if (typeof metadata.connectionId !== 'string' || typeof fields.threadId !== 'string') throw new Error('Mail identity unavailable');
    return { connectionId: metadata.connectionId, threadId: fields.threadId };
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
        response = await this.adapter.executeWithPolicy({ context: { principalId: input.activation.ownerId, toolkits: ['gmail'] },
          connection, installation, signal: input.signal,
          action: { connectorId: connection.connectorId, toolkit: 'gmail', actionId: ACTION, scope: 'read', curated: true, cachedAt: new Date(startedAt).toISOString() },
          args: { user_id: 'me', thread_id: origin.threadId, ...(pageToken ? { page_token: pageToken } : {}) } });
      } catch {
        input.signal.throwIfAborted();
        throw new SceneSourceNotReady();
      }
      input.signal.throwIfAborted();
      if (response.decision !== 'allowed') throw new Error('Mail connector permission is required');
      const envelope = record(response.result);
      const data = record(envelope.data);
      if (envelope.successful !== true || envelope.error || !Array.isArray(data.messages) || data.messages.some(message => !message || typeof message !== 'object')) {
        throw new SceneSourceNotReady();
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
