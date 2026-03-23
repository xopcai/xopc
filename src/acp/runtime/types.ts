/**
 * ACP Runtime Types
 * 
 * Core type definitions for Agent Control Protocol runtime abstraction.
 */

/** ACP prompt mode */
export type AcpRuntimePromptMode = "prompt" | "steer";

/** ACP session mode */
export type AcpRuntimeSessionMode = "persistent" | "oneshot";

/** ACP session update tag */
export type AcpSessionUpdateTag =
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "usage_update"
  | "available_commands_update"
  | "current_mode_update"
  | "config_option_update"
  | "session_info_update"
  | "plan"
  | (string & {});

/** ACP runtime control capability */
export type AcpRuntimeControl = 
  | "session/set_mode" 
  | "session/set_config_option" 
  | "session/status"
  | "session/reset";

/** ACP runtime handle (session reference) */
export type AcpRuntimeHandle = {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  /** Effective working directory */
  cwd?: string;
  /** Local backend record id */
  acpxRecordId?: string;
  /** Backend-level ACP session id */
  backendSessionId?: string;
  /** Upstream harness session id */
  agentSessionId?: string;
};

/** ACP session ensure / init input */
export type AcpRuntimeEnsureInput = {
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
};

/** ACP turn attachment */
export type AcpRuntimeTurnAttachment = {
  mediaType: string;
  data: string;
};

/** ACP turn input */
export type AcpRuntimeTurnInput = {
  handle: AcpRuntimeHandle;
  text: string;
  attachments?: AcpRuntimeTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  signal?: AbortSignal;
};

/** ACP runtime capabilities */
export type AcpRuntimeCapabilities = {
  controls: AcpRuntimeControl[];
  /**
   * Optional advertised config option keys.
   * Empty/omitted means the backend accepts keys without a fixed list.
   */
  configOptionKeys?: string[];
  /** Optional tool names supported by the backend */
  toolNames?: string[];
};

/** ACP runtime status snapshot */
export type AcpRuntimeStatus = {
  summary?: string;
  /** Local backend record id */
  acpxRecordId?: string;
  /** Backend-level ACP session id */
  backendSessionId?: string;
  /** Upstream harness session id */
  agentSessionId?: string;
  details?: Record<string, unknown>;
};

/** ACP doctor (health) report */
export type AcpRuntimeDoctorReport = {
  ok: boolean;
  code?: string;
  message: string;
  installCommand?: string;
  details?: string[];
};

/** ACP runtime event */
export type AcpRuntimeEvent =
  | {
      type: "text_delta";
      text: string;
      stream?: "output" | "thought";
      tag?: AcpSessionUpdateTag;
    }
  | {
      type: "status";
      text: string;
      tag?: AcpSessionUpdateTag;
      used?: number;
      size?: number;
    }
  | {
      type: "tool_call";
      text: string;
      tag?: AcpSessionUpdateTag;
      toolCallId?: string;
      status?: "start" | "progress" | "end" | "error";
      title?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    }
  | {
      type: "done";
      stopReason?: string;
    }
  | {
      type: "error";
      message: string;
      code?: string;
      retryable?: boolean;
    };

/** ACP runtime implementation */
export interface AcpRuntime {
  /** Ensure a session exists (create or resume) */
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;

  /** Run one turn */
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;

  /** Advertised capabilities */
  getCapabilities?(input: {
    handle?: AcpRuntimeHandle;
  }): Promise<AcpRuntimeCapabilities> | AcpRuntimeCapabilities;

  /** Current status */
  getStatus?(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus>;

  /** Set session mode */
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;

  /** Set a config option */
  setConfigOption?(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void>;

  /** Reset session */
  resetSession?(input: { handle: AcpRuntimeHandle }): Promise<void>;

  /** Health check */
  doctor?(): Promise<AcpRuntimeDoctorReport>;

  /** Cancel in-flight work */
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;

  /** Close session */
  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;
}

/** ACP session metadata */
export type SessionAcpMeta = {
  backend: string;
  agent: string;
  runtimeSessionName: string;
  identity?: SessionIdentity;
  mode: AcpRuntimeSessionMode;
  runtimeOptions?: AcpSessionRuntimeOptions;
  cwd?: string;
  state: "idle" | "running" | "error";
  lastActivityAt: number;
  lastError?: string;
};

/** Session identity source */
export type SessionIdentitySource = "ensure" | "status" | "event";

/** Session identity */
export type SessionIdentity = {
  state: "resolved" | "pending";
  source: SessionIdentitySource;
  /** Local backend record id (acpx record id) */
  acpxRecordId?: string;
  /** Backend-level ACP session id */
  acpxSessionId?: string;
  /** Upstream harness session id */
  agentSessionId?: string;
  lastUpdatedAt: number;
};

/** ACP session runtime options */
export type AcpSessionRuntimeOptions = {
  cwd?: string;
  runtimeMode?: string;
  [key: string]: unknown;
};

/** ACP session status (control plane) */
export type AcpSessionStatus = {
  sessionKey: string;
  backend: string;
  agent: string;
  identity?: SessionIdentity;
  state: "idle" | "running" | "error";
  mode: AcpRuntimeSessionMode;
  runtimeOptions?: AcpSessionRuntimeOptions;
  capabilities?: AcpRuntimeCapabilities;
  runtimeStatus?: AcpRuntimeStatus;
  lastActivityAt: number;
  lastError?: string;
};

/** ACP session resolution outcome */
export type AcpSessionResolution =
  | { kind: "ready"; sessionKey: string; meta: SessionAcpMeta }
  | { kind: "stale"; sessionKey: string; error: Error }
  | { kind: "none"; sessionKey: string };