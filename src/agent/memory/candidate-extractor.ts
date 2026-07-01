import type { MemoryEvidence, MemoryKind, MemorySensitivity, MemoryWriteRequest } from './types.js';

const MAX_CANDIDATE_CHARS = 600;

const EXPLICIT_PATTERNS: RegExp[] = [
  /\b(?:please\s+)?remember(?:\s+that)?\s+(.+)/i,
  /\bkeep\s+in\s+mind(?:\s+that)?\s+(.+)/i,
  /(?:请)?记住[：:\s]*(.+)/,
  /以后(?:都)?(?:请)?[：:\s]*(.+)/,
  /下次(?:请)?[：:\s]*(.+)/,
];

function cleanCandidateContent(raw: string): string {
  return raw
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CANDIDATE_CHARS);
}

function inferKind(content: string): MemoryKind {
  const lower = content.toLowerCase();
  if (/\b(prefer|preference|like)\b/i.test(content) || /喜欢|偏好|习惯/.test(content)) {
    return 'user_profile';
  }
  if (/\b(tool|command|pnpm|npm|git|ripgrep|rg)\b/i.test(content) || /工具|命令/.test(content)) {
    return 'tool_preference';
  }
  if (/\b(project|repo|codebase|workspace)\b/i.test(content) || /项目|仓库|代码库/.test(content)) {
    return 'workspace_fact';
  }
  if (/\b(next time|lesson|avoid|failed|error)\b/i.test(lower) || /下次|教训|失败|错误|不要/.test(content)) {
    return 'task_lesson';
  }
  return 'agent_note';
}

function inferSensitivity(kind: MemoryKind, content: string): MemorySensitivity {
  if (/\b(api[_-]?key|token|password|secret|credential)\b/i.test(content) || /密钥|密码|令牌/.test(content)) {
    return 'secret';
  }
  if (kind === 'user_profile') {
    return 'personal';
  }
  return 'normal';
}

function extractExplicitContent(userContent: string): string | null {
  const lines = userContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.length > 0 ? lines : [userContent.trim()]) {
    for (const pattern of EXPLICIT_PATTERNS) {
      const match = pattern.exec(line);
      const content = cleanCandidateContent(match?.[1] ?? '');
      if (content.length >= 8) {
        return content;
      }
    }
  }
  return null;
}

export function proposeMemoryCandidatesFromTurn(params: {
  userContent: string;
  assistantContent?: string;
  sessionKey?: string;
}): MemoryWriteRequest[] {
  const content = extractExplicitContent(params.userContent);
  if (!content) {
    return [];
  }
  const kind = inferKind(content);
  const evidence: MemoryEvidence[] = [
    {
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      sourceText: params.userContent.trim().slice(0, MAX_CANDIDATE_CHARS),
    },
  ];
  return [
    {
      kind,
      target: kind === 'user_profile' ? 'user' : 'memory',
      content,
      status: 'candidate',
      sensitivity: inferSensitivity(kind, content),
      confidence: 0.72,
      evidence,
      tags: ['auto-proposed', 'explicit-user-request'],
      source: {
        provider: 'turn-sync',
        ...(params.sessionKey ? { sessionEntryId: params.sessionKey } : {}),
      },
    },
  ];
}
