/**
 * In-memory bilingual (Latin + CJK) BM25F search index for skills.
 *
 * Indexes name, category/tags, descriptions (default + en/zh-CN localizations),
 * and SKILL.md H1-H3 headings so large skill libraries stay fast and discoverable
 * without database migrations or prompt bloat.
 */

import { compareSkillsForPrompt } from './format-skills-prompt.js';
import type { Skill, SkillsConfig } from './types.js';

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const FIELD_WEIGHTS = {
  name: 4.0,
  taxonomy: 3.0,
  description: 2.0,
  headings: 1.0,
} as const;

type FieldName = keyof typeof FIELD_WEIGHTS;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for',
  'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'use', 'using', 'when', 'with', 'you', 'your',
]);

export interface SkillSearchOptions {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
  skillsConfig?: SkillsConfig;
}

export interface SkillSearchHit {
  skill: Skill;
  score: number;
  matchedOn: FieldName[];
}

export interface SkillCategorySummary {
  category: string;
  count: number;
}

export interface SkillSearchResult {
  total: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  categories: SkillCategorySummary[];
  hits: SkillSearchHit[];
}

interface IndexedSkillDoc {
  skill: Skill;
  nameLower: string;
  searchBlobs: Record<FieldName, string>;
  fieldTf: Record<FieldName, Map<string, number>>;
  fieldLen: Record<FieldName, number>;
  allTerms: Set<string>;
}

/**
 * Tokenize mixed English/identifier/CJK text into search terms.
 * - Splits camelCase and kebab/snake identifiers
 * - Generates Han bigrams (and short whole Han runs) for Chinese recall
 */
export function tokenizeSkillText(text: string): string[] {
  if (!text) return [];
  const normalized = text.normalize('NFKC');
  const tokens: string[] = [];

  // Split camelCase boundaries before lowercasing
  const separated = normalized.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2').toLowerCase();

  // Latin / alphanumeric tokens
  const latinMatches = separated.match(/[a-z0-9]+/g);
  if (latinMatches) {
    for (const token of latinMatches) {
      if (token.length === 1 && !/^[0-9]$/.test(token)) continue;
      if (STOP_WORDS.has(token)) continue;
      tokens.push(token);
    }
  }

  // Han (CJK) runs -> bigrams + short full words
  const hanRuns = normalized.match(/\p{Script=Han}+/gu);
  if (hanRuns) {
    for (const run of hanRuns) {
      if (run.length === 1) {
        tokens.push(run);
        continue;
      }
      if (run.length <= 4) {
        tokens.push(run);
      }
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }

  return tokens;
}

function buildTermFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

function summarizeSkillCategories(skills: Skill[]): SkillCategorySummary[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    const key = skill.category?.trim() || 'uncategorized';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}

export class SkillSearchIndex {
  private docs = new Map<string, IndexedSkillDoc>();
  private docFreq = new Map<string, number>();
  private avgFieldLen: Record<FieldName, number> = {
    name: 1,
    taxonomy: 1,
    description: 1,
    headings: 1,
  };
  private totalDocs = 0;

  constructor(skills: Skill[]) {
    this.build(skills);
  }

  private build(skills: Skill[]): void {
    const fieldLenSums: Record<FieldName, number> = {
      name: 0,
      taxonomy: 0,
      description: 0,
      headings: 0,
    };

    for (const skill of skills) {
      const localizedNames = [
        skill.localizations?.en?.displayName,
        skill.localizations?.['zh-CN']?.displayName,
      ]
        .filter(Boolean)
        .join(' ');
      const localizedDescs = [
        skill.localizations?.en?.description,
        skill.localizations?.['zh-CN']?.description,
      ]
        .filter(Boolean)
        .join(' ');

      const nameText = [skill.name, localizedNames].filter(Boolean).join(' ');
      const taxonomyText = [skill.category, ...(skill.tags ?? [])].filter(Boolean).join(' ');
      const descriptionText = [skill.description, localizedDescs].filter(Boolean).join(' ');
      const headingsText = (skill.headings ?? []).join(' ');

      const rawFields: Record<FieldName, string> = {
        name: nameText,
        taxonomy: taxonomyText,
        description: descriptionText,
        headings: headingsText,
      };

      const fieldTf = {} as Record<FieldName, Map<string, number>>;
      const fieldLen = {} as Record<FieldName, number>;
      const searchBlobs = {} as Record<FieldName, string>;
      const allTerms = new Set<string>();

      for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
        const text = rawFields[field];
        searchBlobs[field] = text.normalize('NFKC').toLowerCase();
        const tokens = tokenizeSkillText(text);
        fieldTf[field] = buildTermFreq(tokens);
        fieldLen[field] = tokens.length;
        fieldLenSums[field] += tokens.length;
        for (const term of fieldTf[field].keys()) {
          allTerms.add(term);
        }
      }

      for (const term of allTerms) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }

      this.docs.set(skill.name, {
        skill,
        nameLower: skill.name.normalize('NFKC').toLowerCase(),
        searchBlobs,
        fieldTf,
        fieldLen,
        allTerms,
      });
    }

    this.totalDocs = this.docs.size;
    const denom = Math.max(1, this.totalDocs);
    for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
      this.avgFieldLen[field] = Math.max(1, fieldLenSums[field] / denom);
    }
  }

  search(visibleSkills: Skill[], options: SkillSearchOptions = {}): SkillSearchResult {
    const rawCategory = options.category?.trim().toLowerCase();
    const filtered = rawCategory
      ? visibleSkills.filter((skill) => {
          const cat = skill.category?.trim().toLowerCase() || 'uncategorized';
          return cat === rawCategory;
        })
      : visibleSkills;

    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const rawQuery = options.query?.trim() ?? '';

    if (!rawQuery) {
      const sorted = [...filtered].sort((a, b) =>
        compareSkillsForPrompt(a, b, options.skillsConfig),
      );
      const page = sorted.slice(offset, offset + limit);
      return {
        total: sorted.length,
        returned: page.length,
        offset,
        hasMore: offset + page.length < sorted.length,
        categories: summarizeSkillCategories(sorted),
        hits: page.map((skill) => ({ skill, score: 0, matchedOn: [] })),
      };
    }

    const queryLower = rawQuery.normalize('NFKC').toLowerCase();
    const queryTerms = [...new Set(tokenizeSkillText(rawQuery))];
    const totalN = Math.max(1, this.totalDocs);

    const scored: SkillSearchHit[] = [];
    for (const skill of filtered) {
      const doc = this.docs.get(skill.name);
      if (!doc) continue;

      let score = 0;
      const matchedFields = new Set<FieldName>();

      // BM25F over tokenized query terms
      for (const term of queryTerms) {
        const df = this.docFreq.get(term) ?? 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (totalN - df + 0.5) / (df + 0.5));

        for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
          const tf = doc.fieldTf[field].get(term) ?? 0;
          if (tf === 0) continue;
          const len = doc.fieldLen[field];
          const avgLen = this.avgFieldLen[field];
          const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (len / avgLen)));
          score += FIELD_WEIGHTS[field] * idf * tfNorm;
          matchedFields.add(field);
        }
      }

      // Exact / literal substring boosts preserve predictable recall for identifiers & short phrases
      if (doc.nameLower === queryLower) {
        score += 20;
        matchedFields.add('name');
      } else if (doc.nameLower.startsWith(queryLower)) {
        score += 8;
        matchedFields.add('name');
      } else if (doc.nameLower.includes(queryLower)) {
        score += 5;
        matchedFields.add('name');
      }

      if (doc.searchBlobs.taxonomy.includes(queryLower)) {
        score += 4;
        matchedFields.add('taxonomy');
      }
      if (doc.searchBlobs.description.includes(queryLower)) {
        score += 2.5;
        matchedFields.add('description');
      }
      if (doc.searchBlobs.headings.includes(queryLower)) {
        score += 1.5;
        matchedFields.add('headings');
      }

      if (score > 0) {
        scored.push({
          skill,
          score,
          matchedOn: [...matchedFields],
        });
      }
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        compareSkillsForPrompt(a.skill, b.skill, options.skillsConfig),
    );

    const page = scored.slice(offset, offset + limit);
    return {
      total: scored.length,
      returned: page.length,
      offset,
      hasMore: offset + page.length < scored.length,
      categories: summarizeSkillCategories(scored.map((hit) => hit.skill)),
      hits: page,
    };
  }
}
