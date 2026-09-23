import { randomUUID } from 'node:crypto';

import type { ChatPreviewRecord, ChatPreviewRevision, ChatPreviewSource } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/index.js';

type PreviewRow = {
  preview_id: string;
  conversation_id: string;
  title: string;
  preferred_height: number;
  latest_revision: string;
  created_at: number;
  updated_at: number;
};

type RevisionRow = {
  preview_id: string;
  source_hash: string;
  markup: string;
  styles: string;
  script: string;
  promoted_app_id: string | null;
  created_at: number;
};

function previewFromRow(row: PreviewRow): ChatPreviewRecord {
  return {
    id: row.preview_id,
    conversationId: row.conversation_id,
    title: row.title,
    preferredHeight: row.preferred_height,
    latestRevision: row.latest_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function revisionFromRow(row: RevisionRow): ChatPreviewRevision {
  return {
    previewId: row.preview_id,
    sourceHash: row.source_hash,
    markup: row.markup,
    styles: row.styles,
    script: row.script,
    createdAt: row.created_at,
  };
}

export class ChatPreviewStore {
  create(input: {
    conversationId: string;
    title: string;
    preferredHeight: number;
    sourceHash: string;
    source: ChatPreviewSource;
  }): { preview: ChatPreviewRecord; revision: ChatPreviewRevision } {
    const id = randomUUID();
    const now = Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(`INSERT INTO chat_previews (
        preview_id, conversation_id, title, preferred_height, latest_revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.conversationId, input.title, input.preferredHeight, input.sourceHash, now, now,
      );
      db.prepare(`INSERT INTO chat_preview_revisions (
        preview_id, source_hash, markup, styles, script, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        id, input.sourceHash, input.source.markup, input.source.styles, input.source.script, now,
      );
    });
    return { preview: this.get(id)!, revision: this.getRevision(id, input.sourceHash)! };
  }

  get(id: string): ChatPreviewRecord | null {
    const row = getSqliteDatabase().prepare('SELECT * FROM chat_previews WHERE preview_id = ?')
      .get(id) as PreviewRow | undefined;
    return row ? previewFromRow(row) : null;
  }

  getRevision(id: string, sourceHash: string): ChatPreviewRevision | null {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM chat_preview_revisions WHERE preview_id = ? AND source_hash = ?',
    ).get(id, sourceHash) as RevisionRow | undefined;
    return row ? revisionFromRow(row) : null;
  }

  getPromotedAppId(id: string, sourceHash: string): string | null {
    const row = getSqliteDatabase().prepare(
      'SELECT promoted_app_id FROM chat_preview_revisions WHERE preview_id = ? AND source_hash = ?',
    ).get(id, sourceHash) as { promoted_app_id: string | null } | undefined;
    return row?.promoted_app_id ?? null;
  }

  setPromotedAppId(id: string, sourceHash: string, appId: string): void {
    const result = getSqliteDatabase().prepare(
      `UPDATE chat_preview_revisions SET promoted_app_id = ?
       WHERE preview_id = ? AND source_hash = ? AND promoted_app_id IS NULL`,
    ).run(appId, id, sourceHash);
    if (result.changes !== 1) throw new Error('Chat preview revision was already promoted or no longer exists');
  }

  revise(input: {
    id: string;
    expectedRevision: string;
    sourceHash: string;
    source: ChatPreviewSource;
    title?: string;
    preferredHeight?: number;
  }): { preview: ChatPreviewRecord; revision: ChatPreviewRevision } | null {
    const now = Date.now();
    return runSqliteWriteTransaction((db) => {
      const current = db.prepare('SELECT * FROM chat_previews WHERE preview_id = ?')
        .get(input.id) as PreviewRow | undefined;
      if (!current || current.latest_revision !== input.expectedRevision) return null;
      db.prepare(`INSERT OR IGNORE INTO chat_preview_revisions (
        preview_id, source_hash, markup, styles, script, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        input.id, input.sourceHash, input.source.markup, input.source.styles, input.source.script, now,
      );
      db.prepare(`UPDATE chat_previews SET
        title = ?, preferred_height = ?, latest_revision = ?, updated_at = ?
        WHERE preview_id = ?`).run(
        input.title ?? current.title,
        input.preferredHeight ?? current.preferred_height,
        input.sourceHash,
        now,
        input.id,
      );
      return {
        preview: this.get(input.id)!,
        revision: this.getRevision(input.id, input.sourceHash)!,
      };
    });
  }
}
