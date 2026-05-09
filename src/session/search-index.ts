/**
 * In-memory inverted index over session transcript JSON files on disk.
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { FILENAMES } from '../config/paths.js';
import { fileStemToSessionKey } from './session-file-key.js';
import { parseStoredTranscriptJson } from './transcript-format.js';
import { isTranscriptContextEntry, type TranscriptStoredRow } from './session-context-for-llm.js';

interface IndexedSession {
  key: string;
  messages: AgentMessage[];
  wordIndex: Map<string, Set<number>>;
}

export class SessionSearchIndex {
  private sessions = new Map<string, IndexedSession>();
  private globalWordIndex = new Map<string, Set<string>>();

  /**
   * Scan `sessionsRoot` (same root as {@link SessionStore}: sharded `*.json`, excludes index/archive).
   */
  async buildIndex(sessionsRoot: string): Promise<void> {
    this.sessions.clear();
    this.globalWordIndex.clear();

    const files = await this.findSessionJsonFiles(sessionsRoot);

    for (const file of files) {
      try {
        const raw = await readFile(file, 'utf-8');
        const trimmed = raw.trim();
        if (!trimmed) {
          continue;
        }
        try {
          JSON.parse(raw);
        } catch {
          continue;
        }
        const { messages, rows, envelope } = parseStoredTranscriptJson(raw);
        if (!envelope) {
          continue;
        }

        const key = this.extractSessionKeyFromPath(file);
        const wordIndex = this.buildWordIndex(messages);
        this.mergeContextTextIntoWordIndex(wordIndex, rows, messages.length);

        const indexed: IndexedSession = { key, messages, wordIndex };
        this.sessions.set(key, indexed);
        this.mergeIntoGlobalIndex(key, wordIndex);
      } catch {
        /* skip bad files */
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

  private extractSessionKeyFromPath(filePath: string): string {
    const base = basename(filePath, '.json');
    return fileStemToSessionKey(base);
  }

  private async findSessionJsonFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (rel: string): Promise<void> => {
      const abs = join(dir, rel);
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        const childRel = rel ? join(rel, ent.name) : ent.name;
        if (ent.isDirectory()) {
          if (ent.name === 'archive') {
            continue;
          }
          await walk(childRel);
        } else if (
          ent.name.endsWith('.json') &&
          ent.name !== FILENAMES.SESSIONS_INDEX &&
          !ent.name.endsWith('.meta.json')
        ) {
          files.push(join(dir, childRel));
        }
      }
    };

    await walk('');
    return files;
  }

  private buildWordIndex(messages: AgentMessage[]): Map<string, Set<number>> {
    const index = new Map<string, Set<number>>();

    for (let i = 0; i < messages.length; i++) {
      const text = extractIndexableText(messages[i]?.content);
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

  /** Index `kind: 'context'` `text` / `id` so session search matches audit rows (synthetic slot indices). */
  private mergeContextTextIntoWordIndex(
    wordIndex: Map<string, Set<number>>,
    rows: TranscriptStoredRow[],
    llmMessageCount: number,
  ): void {
    let slot = 0;
    for (const r of rows) {
      if (!isTranscriptContextEntry(r)) continue;
      const parts: string[] = [];
      if (typeof r.text === 'string' && r.text.trim()) parts.push(r.text);
      if (typeof r.id === 'string' && r.id.trim()) parts.push(r.id);
      const blob = parts.join(' ');
      if (!blob.trim()) continue;
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
    .split(/\W+/)
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
