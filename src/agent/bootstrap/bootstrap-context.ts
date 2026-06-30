import type { Config } from '../../config/schema.js';
import type { EmbeddedContextFile, WorkspaceBootstrapFile } from './types.js';

export const DEFAULT_BOOTSTRAP_MAX_CHARS = 12_000;
export const DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS = 60_000;
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.75;
const BOOTSTRAP_TAIL_RATIO = 0.25;

export function resolveBootstrapMaxChars(config?: Config): number {
  return DEFAULT_BOOTSTRAP_MAX_CHARS;
}

export function resolveBootstrapTotalMaxChars(config?: Config): number {
  return DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS;
}

function clampToBudget(content: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }
  if (content.length <= budget) {
    return content;
  }
  if (budget <= 3) {
    return content.slice(0, budget);
  }
  return `${content.slice(0, budget - 1)}…`;
}

function trimBootstrapContent(
  content: string,
  fileName: string,
  maxChars: number,
): { content: string; truncated: boolean; originalLength: number; maxChars: number } {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return { content: trimmed, truncated: false, originalLength: trimmed.length, maxChars };
  }

  const markerTemplate = (head: number, tail: number) =>
    `\n\n[...truncated ${fileName}: kept ${head}+${tail} of ${trimmed.length} chars...]\n\n`;
  let headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
  let tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
  let marker = markerTemplate(headChars, tailChars);
  let renderedLength = headChars + tailChars + marker.length;

  while (renderedLength > maxChars && (headChars > 0 || tailChars > 0)) {
    if (tailChars >= headChars && tailChars > 0) {
      tailChars -= 1;
    } else if (headChars > 0) {
      headChars -= 1;
    } else {
      break;
    }
    marker = markerTemplate(headChars, tailChars);
    renderedLength = headChars + tailChars + marker.length;
  }

  const head = trimmed.slice(0, headChars);
  const tail = tailChars > 0 ? trimmed.slice(-tailChars) : '';
  const bounded = `${head}${marker}${tail}`;
  return {
    content: bounded.length > maxChars ? bounded.slice(0, maxChars) : bounded,
    truncated: true,
    originalLength: trimmed.length,
    maxChars,
  };
}

export function buildBootstrapContextFiles(
  files: WorkspaceBootstrapFile[],
  opts?: { warn?: (message: string) => void; maxChars?: number; totalMaxChars?: number },
): EmbeddedContextFile[] {
  const maxChars = opts?.maxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const totalMaxChars = Math.max(
    1,
    Math.floor(opts?.totalMaxChars ?? Math.max(maxChars, DEFAULT_BOOTSTRAP_TOTAL_MAX_CHARS)),
  );
  let remainingTotalChars = totalMaxChars;
  const result: EmbeddedContextFile[] = [];

  for (const file of files) {
    if (remainingTotalChars <= 0) {
      break;
    }
    const pathValue = file.path.trim();
    if (!pathValue) {
      opts?.warn?.(`skipping bootstrap file "${file.name}" — missing path`);
      continue;
    }

    if (file.missing) {
      const missingText = `[MISSING] Expected at: ${pathValue}`;
      const capped = clampToBudget(missingText, remainingTotalChars);
      if (!capped) {
        break;
      }
      remainingTotalChars = Math.max(0, remainingTotalChars - capped.length);
      result.push({ path: pathValue, content: capped });
      continue;
    }

    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      opts?.warn?.(
        `remaining bootstrap budget is ${remainingTotalChars} chars (<${MIN_BOOTSTRAP_FILE_BUDGET_CHARS}); skipping additional bootstrap files`,
      );
      break;
    }

    const fileMaxChars = Math.max(1, Math.min(maxChars, remainingTotalChars));
    const trimmed = trimBootstrapContent(file.content ?? '', file.name, fileMaxChars);
    const contentWithinBudget = clampToBudget(trimmed.content, remainingTotalChars);
    if (!contentWithinBudget) {
      continue;
    }
    if (trimmed.truncated || contentWithinBudget.length < trimmed.content.length) {
      opts?.warn?.(
        `profile bootstrap file ${file.name} is ${trimmed.originalLength} chars (limit ${trimmed.maxChars}); truncating in injected context`,
      );
    }
    remainingTotalChars = Math.max(0, remainingTotalChars - contentWithinBudget.length);
    result.push({ path: pathValue, content: contentWithinBudget });
  }

  return result;
}
