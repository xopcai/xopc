/**
 * ACP Runtime Types
 * 
 * Core type definitions for Agent Control Protocol runtime abstraction.
 * Based on OpenClaw's ACP implementation.
 */

/** ACP Prompt 模式 */
export type AcpRuntimePromptMode = "prompt" | "steer";

/** ACP Session 模式 */
export type AcpRuntimeSessionMode = "persistent" | "oneshot";

/** ACP Session Update 标签 */
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

/** ACP Runtime Control 能力 */
export type AcpRuntimeControl = 
  | "session/set_mode" 
  | "session/set_config_option" 
  | "session/status";

/** ACP Runtime Handle - Session 句柄 */
export type AcpRuntimeHandle = {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  /** 有效的工作目录 */
  cwd?: string;
  /** Backend 本地记录标识符 */
  acpxRecordId?: string;
  /** Backend 级别的 ACP Session 标识符 */
  backendSessionId?: string;
  /** 上游 harness session 标识符 */
  agentSessionId?: string;
};

/** ACP Session 初始化输入 */
export type AcpRuntimeEnsureInput = {
  sessionKey: string;
  agent: string;
  mode: AcpRuntimeSessionMode;
  resumeSessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
};

/** ACP Turn 附件 */
export type AcpRuntimeTurnAttachment = {
  mediaType: string;
  data: string;
};

/** ACP Turn 输入 */
export type AcpRuntimeTurnInput = {
  handle: AcpRuntimeHandle;
  text: string;
  attachments?: AcpRuntimeTurnAttachment[];
  mode: AcpRuntimePromptMode;
  requestId: string;
  signal?: AbortSignal;
};

/** ACP Runtime 能力 */
export type AcpRuntimeCapabilities = {
  controls: AcpRuntimeControl[];
  /**
   * 可选的 backend 广告配置选项键
   * 空值表示 backend 接受键，但没有严格列表
   */
  configOptionKeys?: string[];
};

/** ACP Runtime 状态 */
export type AcpRuntimeStatus = {
  summary?: string;
  /** Backend 本地记录标识符 */
  acpxRecordId?: string;
  /** Backend 级别的 ACP Session 标识符 */
  backendSessionId?: string;
  /** 上游 harness session 标识符 */
  agentSessionId?: string;
  details?: Record<string, unknown>;
};

/** ACP Doctor 报告 */
export type AcpRuntimeDoctorReport = {
  ok: boolean;
  code?: string;
  message: string;
  installCommand?: string;
  details?: string[];
};

/** ACP Runtime 事件 */
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
      status?: string;
      title?: string;
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

/** ACP Runtime 接口 */
export interface AcpRuntime {
  /** 确保 Session 存在 */
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;

  /** 运行一个 Turn */
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;

  /** 获取能力 */
  getCapabilities?(input: {
    handle?: AcpRuntimeHandle;
  }): Promise<AcpRuntimeCapabilities> | AcpRuntimeCapabilities;

  /** 获取状态 */
  getStatus?(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus>;

  /** 设置模式 */
  setMode?(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void>;

  /** 设置配置选项 */
  setConfigOption?(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void>;

  /** 健康检查 */
  doctor?(): Promise<AcpRuntimeDoctorReport>;

  /** 取消当前操作 */
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;

  /** 关闭 Session */
  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;
}

/** ACP Session 元数据 */
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

/** Session Identity 来源 */
export type SessionIdentitySource = "ensure" | "status" | "event";

/** Session 身份标识 */
export type SessionIdentity = {
  state: "resolved" | "pending";
  source: SessionIdentitySource;
  /** Backend 本地记录标识符 (acpx record id) */
  acpxRecordId?: string;
  /** Backend 级别的 ACP Session 标识符 */
  acpxSessionId?: string;
  /** 上游 harness session 标识符 */
  agentSessionId?: string;
  lastUpdatedAt: number;
};

/** ACP Session Runtime 选项 */
export type AcpSessionRuntimeOptions = {
  cwd?: string;
  runtimeMode?: string;
  [key: string]: unknown;
};

/** ACP Session 状态 */
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

/** ACP Session 解析结果 */
export type AcpSessionResolution =
  | { kind: "ready"; sessionKey: string; meta: SessionAcpMeta }
  | { kind: "stale"; sessionKey: string; error: Error }
  | { kind: "none"; sessionKey: string };