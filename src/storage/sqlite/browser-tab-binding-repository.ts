import { randomUUID } from 'node:crypto';

import type { BrowserTabBinding, BrowserTabBindingMode } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from './transaction.js';

type BindingRow = {
  binding_id: string;
  conversation_id: string;
  principal_id: string;
  endpoint_id: string;
  tab_id: string;
  window_id: string;
  document_id: string;
  url_origin: string;
  mode: BrowserTabBindingMode;
  created_at: number;
  expires_at: number;
};

function bindingFromRow(row: BindingRow): BrowserTabBinding {
  return {
    id: row.binding_id,
    conversationId: row.conversation_id,
    principalId: row.principal_id,
    endpointId: row.endpoint_id,
    tabId: row.tab_id,
    windowId: row.window_id,
    documentId: row.document_id,
    urlOrigin: row.url_origin,
    mode: row.mode,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function getBrowserTabBinding(conversationId: string, now = Date.now()): BrowserTabBinding | undefined {
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM browser_tab_bindings WHERE expires_at <= ?').run(now);
  const row = db.prepare(`SELECT * FROM browser_tab_bindings WHERE conversation_id = ?`)
    .get(conversationId) as BindingRow | undefined;
  return row ? bindingFromRow(row) : undefined;
}

export function getBrowserTabBindingById(bindingId: string, now = Date.now()): BrowserTabBinding | undefined {
  const db = getSqliteDatabase();
  db.prepare('DELETE FROM browser_tab_bindings WHERE expires_at <= ?').run(now);
  const row = db.prepare(`SELECT * FROM browser_tab_bindings WHERE binding_id = ?`)
    .get(bindingId) as BindingRow | undefined;
  return row ? bindingFromRow(row) : undefined;
}

export function setBrowserTabBinding(input: Omit<BrowserTabBinding, 'id' | 'createdAt' | 'expiresAt'>, now = Date.now()): BrowserTabBinding {
  const binding: BrowserTabBinding = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    expiresAt: now + 8 * 60 * 60 * 1000,
  };
  getSqliteDatabase().prepare(`INSERT INTO browser_tab_bindings (
    binding_id, conversation_id, principal_id, endpoint_id, tab_id, window_id,
    document_id, url_origin, mode, created_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(conversation_id) DO UPDATE SET
    binding_id = excluded.binding_id, principal_id = excluded.principal_id,
    endpoint_id = excluded.endpoint_id, tab_id = excluded.tab_id,
    window_id = excluded.window_id, document_id = excluded.document_id,
    url_origin = excluded.url_origin, mode = excluded.mode,
    created_at = excluded.created_at, expires_at = excluded.expires_at`)
    .run(binding.id, binding.conversationId, binding.principalId, binding.endpointId,
      binding.tabId, binding.windowId, binding.documentId, binding.urlOrigin,
      binding.mode, binding.createdAt, binding.expiresAt);
  return binding;
}

export function deleteBrowserTabBinding(conversationId: string): boolean {
  return getSqliteDatabase().prepare('DELETE FROM browser_tab_bindings WHERE conversation_id = ?')
    .run(conversationId).changes > 0;
}

export function deleteBrowserTabBindingsByEndpoint(endpointId: string): number {
  return Number(getSqliteDatabase().prepare('DELETE FROM browser_tab_bindings WHERE endpoint_id = ?')
    .run(endpointId).changes);
}

export function deleteBrowserTabBindingsByPrincipal(principalId: string): number {
  return Number(getSqliteDatabase().prepare('DELETE FROM browser_tab_bindings WHERE principal_id = ?')
    .run(principalId).changes);
}
