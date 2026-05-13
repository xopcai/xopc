/**
 * In-memory inverted index over session transcripts (`sessions.json` + JSONL).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { FILENAMES } from '../config/paths.js';
import { resolveSessionFilePath } from './parity/transcript-paths.js';
import { readTranscriptRowsFromFile, rowsToLlmMessages } from './parity/jsonl-transcript-io.js';
import { isTranscriptContextEntry, type TranscriptStoredRow } from './session-context-for-llm.js';
import type { XopcSessionDiskEntry } from './parity/xopc-session-disk-entry.js';

interface IndexedSession {
  key: string;
  messages: AgentMessage[];
  wordIndex: Map<string, Set<number>>;
}

export class SessionSearchIndex {
  private sessions = new Map<string, IndexedSession>();
  private globalWordIndex = new Map<string, Set<string>>();

  /**
   * Scan `sessionsRoot` (flat `sessions.json` + per-session `.jsonl` transcripts).
   */
  async buildIndex(sessionsRoot: string): Promise<void> {
    this.sessions.clear();
    this.globalWordIndex.clear();

    const mapPath = join(sessionsRoot, FILENAMES.SESSIONS_MAP);
    let raw: string;
    try {
      raw = await readFile(mapPath, 'utf-8');
    } catch {
      return;
    }
    let map: Record<string, XopcSessionDiskEntry>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }
      map = parsed as Record<string, XopcSessionDiskEntry>;
    } catch {
      return;
    }

    for (const [sessionKey, entry] of Object.entries(map)) {
      if (!entry?.sessionId) {
        continue;
      }
      try {
        const transcriptPath = resolveSessionFilePath(entry.sessionId, entry, { sessionsDir: sessionsRoot });
        const rows = await readTranscriptRowsFromFile(transcriptPath);
        const messages = rowsToLlmMessages(rows);
        const wordIndex = this.buildWordIndex(messages);
        this.mergeContextTextIntoWordIndex(wordIndex, rows, messages.length);
        const indexed: IndexedSession = { key: sessionKey, messages, wordIndex };
        this.sessions.set(sessionKey, indexed);
        this.mergeIntoGlobalIndex(sessionKey, wordIndex);
      } catch {
        /* skip */
      }
    }
  }

  search(query: string, limit = 10): Array<{ key: string; score: number }> {
    const queryWords = tokenizeWords(query);
    if (queryWords.length === 0) {
      return [];
    }
    const scores = new Map<string, number>();
    for (const word of queryWords) {
      const matchingSessions = this.globalWordIndex.get(word);
      if (!matchingSessions) {
        continue;
      }
      for (const sessionKey of matchingSessions) {
        scores.set(sessionKey, (scores.get(sessionKey) || 0) + 1);
      }
    }
    return Array.from(scores.entries())
      .map(([key, score]) => ({ key, score: score / queryWords.length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getSessionMessages(key: string): AgentMessage[] {
    return this.sessions.get(key)?.messages ?? [];
  }

  private buildWordIndex(messages: AgentMessage[]): Map<string, Set<number>> {
    const index = new Map<string, Set<number>>();
    for (let i = 0; i < messages.length; i++) {
      const text = extractIndexableText((messages[i] as { content?: unknown }).content);
      const words = tokenizeWords(text);
      for (const word of words) {
        if (!index.has(word)) {
          index.set(word, new Set());
        }
        index.get(word)!.add(i);
      }
    }
    return index;
  }

  private mergeContextTextIntoWordIndex(
    wordIndex: Map<string, Set<number>>,
    rows: TranscriptStoredRow[],
    llmMessageCount: number,
  ): void {
    let slot = 0;
    for (const r of rows) {
      if (!isTranscriptContextEntry(r)) {
        continue;
      }
      const parts: string[] = [];
      if (typeof r.text === 'string' && r.text.trim()) {
        parts.push(r.text);
      }
      if (typeof r.id === 'string' && r.id.trim()) {
        parts.push(r.id);
      }
      const blob = parts.join(' ');
      if (!blob.trim()) {
        continue;
      }
      const words = tokenizeWords(blob);
      const idx = llmMessageCount + slot;
      slot += 1;
      for (const word of words) {
        if (!wordIndex.has(word)) {
          wordIndex.set(word, new Set());
        }
        wordIndex.get(word)!.add(idx);
      }
    }
  }

  private mergeIntoGlobalIndex(sessionKey: string, wordIndex: Map<string, Set<number>>): void {
    for (const word of wordIndex.keys()) {
      if (!this.globalWordIndex.has(word)) {
        this.globalWordIndex.set(word, new Set());
      }
      this.globalWordIndex.get(word)!.add(sessionKey);
    }
  }
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\W_]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function extractIndexableText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== 'object' || item === null || !('type' in item)) {
      continue;
    }
    const c = item as { type?: string; text?: string };
    if (c.type === 'text' && typeof c.text === 'string') {
      parts.push(c.text);
    }
  }
  return parts.join(' ');
}
