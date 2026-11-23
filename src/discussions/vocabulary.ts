import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveStateDir } from '../config/paths.js';

export interface DiscussionVocabularySettings {
  hotwords: string[];
  diarizationEnabled: boolean;
  updatedAt: number;
}

const MAX_HOTWORDS = 100;
const MAX_HOTWORD_LENGTH = 48;

export function normalizeHotwords(input: unknown): string[] {
  const rawList: string[] = Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string')
    : typeof input === 'string'
      ? input.split(/[\n,，;；、]+/)
      : [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawList) {
    const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_HOTWORD_LENGTH);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_HOTWORDS) break;
  }
  return result;
}

function vocabularyFilePath(): string {
  return join(resolveStateDir(), 'discussions', 'vocabulary.json');
}

export function readDiscussionVocabulary(): DiscussionVocabularySettings {
  const path = vocabularyFilePath();
  if (!existsSync(path)) {
    return { hotwords: [], diarizationEnabled: true, updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DiscussionVocabularySettings>;
    return {
      hotwords: normalizeHotwords(parsed.hotwords),
      diarizationEnabled: parsed.diarizationEnabled !== false,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return { hotwords: [], diarizationEnabled: true, updatedAt: 0 };
  }
}

export function updateDiscussionVocabulary(patch: {
  hotwords?: unknown;
  diarizationEnabled?: boolean;
}): DiscussionVocabularySettings {
  const current = readDiscussionVocabulary();
  const next: DiscussionVocabularySettings = {
    hotwords: patch.hotwords !== undefined ? normalizeHotwords(patch.hotwords) : current.hotwords,
    diarizationEnabled:
      typeof patch.diarizationEnabled === 'boolean'
        ? patch.diarizationEnabled
        : current.diarizationEnabled,
    updatedAt: Date.now(),
  };

  const path = vocabularyFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmpPath, path);
  return next;
}

export function buildHotwordsPrompt(hotwords?: string[]): string | undefined {
  const terms = (hotwords ?? readDiscussionVocabulary().hotwords).filter(Boolean);
  if (terms.length === 0) return undefined;
  return `专有名词与人名词汇表：${terms.join('、')}`;
}
