import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Config } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { resolveAgentProfileDir } from '../agent-scope.js';

const MAX_CONTEXT_CHARS = 1800;
const DEFAULT_POST_COMPACTION_SECTIONS = ['Session Startup', 'Red Lines'];

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase();
}

export function extractSections(
  content: string,
  sectionNames: string[],
  foundNames?: string[],
): string[] {
  const results: string[] = [];
  const lines = content.split('\n');

  for (const name of sectionNames) {
    let sectionLines: string[] = [];
    let inSection = false;
    let sectionLevel = 0;
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inSection) {
          sectionLines.push(line);
        }
        continue;
      }
      if (inCodeBlock) {
        if (inSection) {
          sectionLines.push(line);
        }
        continue;
      }

      const headingMatch = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        if (!inSection) {
          if (normalizeHeading(headingText) === normalizeHeading(name)) {
            inSection = true;
            sectionLevel = level;
            sectionLines = [line];
          }
          continue;
        }
        if (level <= sectionLevel) {
          break;
        }
        sectionLines.push(line);
        continue;
      }

      if (inSection) {
        sectionLines.push(line);
      }
    }

    if (sectionLines.length > 0) {
      results.push(sectionLines.join('\n').trim());
      foundNames?.push(name);
    }
  }

  return results;
}

export type PostCompactionContextOptions = {
  cfg?: Config;
  agentId?: string;
  nowMs?: number;
  userTimezone?: string;
};

export function readPostCompactionContextFromAgentsMd(
  agentsMdContent: string,
  options?: PostCompactionContextOptions,
): string | null {
  const compaction = (options?.cfg?.agents as unknown as {
    defaults?: { compaction?: { enabled?: boolean; postCompactionSections?: string[] } };
  } | undefined)?.defaults?.compaction;
  if (compaction?.enabled === false) {
    return null;
  }
  const sectionNames = Array.isArray(compaction?.postCompactionSections)
    ? compaction.postCompactionSections
    : DEFAULT_POST_COMPACTION_SECTIONS;

  if (sectionNames.length === 0) {
    return null;
  }

  const foundSectionNames: string[] = [];
  const sections = extractSections(agentsMdContent, sectionNames, foundSectionNames);
  if (sections.length === 0) {
    return null;
  }

  const displayNames = foundSectionNames.length > 0 ? foundSectionNames : sectionNames;
  const timezone =
    options?.userTimezone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';
  const nowMs = options?.nowMs ?? Date.now();
  const dateStamp = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(nowMs));
  const maxContextChars = MAX_CONTEXT_CHARS;

  const combined = sections.join('\n\n').replaceAll('YYYY-MM-DD', dateStamp);
  const safeContent =
    combined.length > maxContextChars
      ? `${combined.slice(0, maxContextChars)}\n...[truncated]...`
      : combined;

  const isDefaultSections =
    sectionNames.length === DEFAULT_POST_COMPACTION_SECTIONS.length &&
      sectionNames.every(
        (name, index) =>
          normalizeHeading(name) === normalizeHeading(DEFAULT_POST_COMPACTION_SECTIONS[index] ?? ''),
      );

  const prose = isDefaultSections
    ? 'Session was just compacted. The conversation summary above is a hint, NOT a substitute for your startup sequence. ' +
      'Run your Session Startup sequence — required files are already in Project Context; follow Session Startup and Red Lines before responding.'
    : `Session was just compacted. Re-read the sections injected below (${displayNames.join(', ')}) and follow your configured startup procedure before responding.`;

  const sectionLabel = isDefaultSections
    ? 'Critical rules from AGENTS.md:'
    : `Injected sections from AGENTS.md (${displayNames.join(', ')}):`;

  return (
    `[Post-compaction context refresh]\n\n${prose}\n\n${sectionLabel}\n\n${safeContent}`
  );
}

export function readPostCompactionContext(params: {
  cfg?: Config;
  sessionKey?: string;
  agentId?: string;
  nowMs?: number;
  userTimezone?: string;
}): string | null {
  const cfg = params.cfg;
  if (!cfg) {
    return null;
  }
  let agentId = params.agentId;
  if (!agentId && params.sessionKey) {
    try {
      agentId = resolveEffectiveAgentProfileForSession(cfg, params.sessionKey).agentId;
    } catch {
      return null;
    }
  }
  if (!agentId) {
    return null;
  }
  const agentsPath = join(resolveAgentProfileDir(cfg, agentId), 'AGENTS.md');
  const resolved = resolve(agentsPath);
  try {
    const content = readFileSync(resolved, 'utf-8');
    return readPostCompactionContextFromAgentsMd(content, {
      cfg,
      agentId,
      nowMs: params.nowMs,
      userTimezone: params.userTimezone,
    });
  } catch {
    return null;
  }
}
