import fs from "node:fs/promises";

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

/**
 * pi-coding-agent SessionManager persistence quirk:
 * - If the file exists but has no assistant message, SessionManager marks itself `flushed=true`
 *   and will never persist the initial user message.
 * - If the file doesn't exist yet, SessionManager builds a new session in memory and flushes
 *   header+user+assistant once the first assistant arrives (good).
 *
 * This normalizes the file/session state so the first user prompt is persisted before the first
 * assistant entry, even for pre-created session files.
 */
export async function prepareSessionManagerForRun(params: {
  sessionManager: unknown;
  sessionFile: string;
  hadSessionFile: boolean;
  sessionId: string;
  cwd: string;
}): Promise<void> {
  const sm = params.sessionManager as {
    sessionId: string;
    flushed: boolean;
    fileEntries: Array<SessionHeaderEntry | SessionMessageEntry | { type: string }>;
    byId?: Map<string, unknown>;
    labelsById?: Map<string, unknown>;
    leafId?: string | null;
  };

  const header = sm.fileEntries.find((e): e is SessionHeaderEntry => e.type === "session");
  const hasAssistant = sm.fileEntries.some(
    (e) => e.type === "message" && (e as SessionMessageEntry).message?.role === "assistant",
  );

  if (!params.hadSessionFile && header) {
    header.id = params.sessionId;
    header.cwd = params.cwd;
    sm.sessionId = params.sessionId;
    return;
  }

  if (params.hadSessionFile && header && !hasAssistant) {
    // Remove the pre-created transcript so pi SessionManager can create it with O_EXCL
    // on the first assistant flush (pi-coding-agent 0.77+ uses open(..., "wx") there).
    try {
      await fs.unlink(params.sessionFile);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw err;
      }
    }
    sm.fileEntries = [header];
    sm.byId?.clear?.();
    sm.labelsById?.clear?.();
    sm.leafId = null;
    sm.flushed = false;
  }

  repairAssistantUsageInSessionManager(sm);
}
