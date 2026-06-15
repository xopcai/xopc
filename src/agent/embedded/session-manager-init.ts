type SessionHeaderEntry = { type: "session"; id?: string; cwd?: string };
type SessionMessageEntry = {
  type: "message";
  message?: {
    role?: string;
    stopReason?: string;
    usage?: Record<string, unknown>;
  };
};

/** pi-coding-agent auto-compaction calls `calculateContextTokens(usage)` without a null check. */
const EMPTY_ASSISTANT_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Legacy xopc transcripts may omit `usage` on assistant rows; pi AgentSession crashes on turn end.
 */
export function repairAssistantUsageInSessionManager(sessionManager: unknown): void {
  const sm = sessionManager as { fileEntries?: Array<SessionHeaderEntry | SessionMessageEntry | { type: string }> };
  if (!Array.isArray(sm.fileEntries)) {
    return;
  }
  for (const entry of sm.fileEntries) {
    if (entry.type !== "message") {
      continue;
    }
    const msg = (entry as SessionMessageEntry).message;
    if (msg?.role !== "assistant") {
      continue;
    }
    if (msg.stopReason === "aborted" || msg.stopReason === "error") {
      continue;
    }
    if (!msg.usage || typeof msg.usage !== "object") {
      msg.usage = { ...EMPTY_ASSISTANT_USAGE };
    } else if (msg.usage.totalTokens === undefined) {
      const u = msg.usage;
      const input = typeof u.input === "number" ? u.input : 0;
      const output = typeof u.output === "number" ? u.output : 0;
      const cacheRead = typeof u.cacheRead === "number" ? u.cacheRead : 0;
      const cacheWrite = typeof u.cacheWrite === "number" ? u.cacheWrite : 0;
      msg.usage = {
        ...EMPTY_ASSISTANT_USAGE,
        ...u,
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
      };
    }
  }
}
