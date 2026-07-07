import { apiFetch } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';
import { apiUrl } from '@/lib/url';

export interface ReviewContextBranch {
  name: string;
  current?: boolean;
  remote?: boolean;
}

export interface ReviewContextCommit {
  sha: string;
  shortSha: string;
  subject: string;
  date?: string;
}

export interface ReviewContext {
  cwd: string;
  defaultBaseBranch?: string;
  status: {
    changedFiles: number;
    untrackedFiles: number;
    isClean: boolean;
  };
  branches: ReviewContextBranch[];
  commits: ReviewContextCommit[];
}

export type ReviewPreset = 'uncommitted' | 'base' | 'commit' | 'custom';

export function quoteReviewArg(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : JSON.stringify(value);
}

function appendInstructions(command: string, instructions?: string): string {
  const trimmed = instructions?.trim();
  return trimmed ? `${command} --instructions ${quoteReviewArg(trimmed)}` : command;
}

export function buildReviewCommand(opts: {
  preset: ReviewPreset;
  baseBranch?: string;
  commitSha?: string;
  instructions?: string;
}): string {
  if (opts.preset === 'base') {
    if (!opts.baseBranch?.trim()) throw new Error('Missing base branch.');
    return appendInstructions(`/review --base ${quoteReviewArg(opts.baseBranch.trim())}`, opts.instructions);
  }
  if (opts.preset === 'commit') {
    if (!opts.commitSha?.trim()) throw new Error('Missing commit SHA.');
    return appendInstructions(`/review --commit ${quoteReviewArg(opts.commitSha.trim())}`, opts.instructions);
  }
  if (opts.preset === 'custom') {
    return appendInstructions('/review --uncommitted', opts.instructions);
  }
  return appendInstructions('/review --uncommitted', opts.instructions);
}

export async function fetchReviewContext(sessionKey: string): Promise<ReviewContext> {
  const params = new URLSearchParams({ sessionKey });
  const res = await apiFetch(apiUrl(`/api/review/context?${params.toString()}`));
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    payload?: ReviewContext;
    error?: { message?: string };
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(formatApiHttpError(res.status, res.statusText, data.error?.message));
  }
  return data.payload;
}
