/**
 * Local ACP Runtime Backend
 *
 * A simple ACP runtime that runs directly in xopcbot's process,
 * using the existing agent system for turn execution.
 */

import { randomUUID } from "node:crypto";
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Model, Api } from "@mariozechner/pi-ai";
import type {
  AcpRuntime,
  AcpRuntimeCapabilities,
  AcpRuntimeDoctorReport,
  AcpRuntimeEnsureInput,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeStatus,
  AcpRuntimeTurnInput,
  SessionAcpMeta,
} from "../types.js";
import { AcpRuntimeError, normalizeAcpErrorCode } from "../errors.js";
import type { MessageBus } from "../../../bus/index.js";
import type { Config } from "../../../config/schema.js";
import { SessionStore } from "../../../session/index.js";
import { resolveModel, getDefaultModelSync, getApiKeySync } from "../../../providers/index.js";
import { resolveBundledSkillsDir } from "../../../config/paths.js";
import { AgentToolsFactory } from "../../../agent/agent-tools-factory.js";
import { SystemPromptBuilder } from "../../../agent/prompt/service-prompt-builder.js";
import { SkillManager } from "../../../agent/skills/index.js";
import { loadBootstrapFiles, extractTextContent } from "../../../agent/helpers.js";
import { cleanTrailingErrors, sanitizeMessages } from "../../../agent/memory/message-sanitizer.js";
import { tryApplySessionTranscriptHygiene } from "../../../agent/transcript/transcript-hygiene.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("LocalAcpRuntime");

/**
 * Local Runtime Configuration
 */
export interface LocalRuntimeConfig {
  /** Agent ID to use */
  agent: string;
  /** Working directory */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Config */
  config?: Config;
  /** Workspace path */
  workspace?: string;
}

/**
 * Session state for Local Runtime
 */
interface LocalSessionState {
  meta: SessionAcpMeta;
  messages: AgentMessage[];
  abortController?: AbortController;
}

/**
 * Local ACP Runtime
 *
 * Implements AcpRuntime by directly using xopcbot's AgentCore,
 * with its own session management.
 */
export class LocalAcpRuntime implements AcpRuntime {
  private readonly sessions = new Map<string, LocalSessionState>();
  private agent: Agent;
  /** Resolved default model for transcript hygiene (OpenClaw-style). */
  private agentModel: Model<Api>;
  private sessionStore: SessionStore;
  private tools: AgentTool<any, any>[] = [];
  private workspace: string;
  private config?: Config;

  constructor(
    private readonly bus: MessageBus,
    private readonly runtimeConfig?: LocalRuntimeConfig
  ) {
    this.workspace = runtimeConfig?.workspace || process.cwd();
    this.config = runtimeConfig?.config;

    // Initialize session store
    this.sessionStore = new SessionStore({ workspace: this.workspace }, {
      maxMessages: 100,
      keepRecentMessages: 20,
      preserveSystemMessages: true,
    }, {
      enabled: true,
      mode: "abstractive",
      reserveTokens: 8000,
      triggerThreshold: 0.8,
      minMessagesBeforeCompact: 10,
      keepRecentMessages: 10,
      evictionWindow: 0.2,
      retentionWindow: 6,
    });

    // Initialize tools
    this.initializeTools();

    // Initialize agent
    const { agent, model } = this.createAgent();
    this.agent = agent;
    this.agentModel = model;

    // Subscribe to agent events
    this.agent.subscribe((event) => this.handleAgentEvent(event));
  }

  /**
   * Initialize tools using AgentToolsFactory pattern
   */
  private initializeTools(): void {
    const toolsFactory = new AgentToolsFactory({
      workspace: this.workspace,
      getCurrentContext: () => null,
      bus: this.bus,
    });
    this.tools = toolsFactory.createAllTools();
    log.info({ toolCount: this.tools.length }, "Local runtime tools initialized");
  }

  /**
   * Create agent instance
   */
  private createAgent(): { agent: Agent; model: Model<Api> } {
    let model: Model<Api>;

    const modelConfig = this.config?.agents?.defaults?.model;
    if (modelConfig) {
      try {
        const modelId = typeof modelConfig === "string" ? modelConfig : modelConfig.primary;
        model = resolveModel(modelId);
      } catch {
        const defaultModel = getDefaultModelSync(this.config);
        log.warn({ modelConfig, defaultModel }, "Model not found, using default");
        model = resolveModel(defaultModel);
      }
    } else {
      const defaultModel = getDefaultModelSync(this.config);
      model = resolveModel(defaultModel);
    }

    const bootstrapFiles = loadBootstrapFiles(this.workspace);
    const skillManager = new SkillManager(this.workspace, resolveBundledSkillsDir());
    
    // Create a minimal config if none provided
    const agentConfig = this.config || {
      gateway: {},
      agents: {},
      channels: {},
      tools: {},
    } as Config;
    
    const systemPromptBuilder = new SystemPromptBuilder({
      workspace: this.workspace,
      config: agentConfig,
      skillManager,
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: systemPromptBuilder.build(bootstrapFiles),
        model,
        tools: this.tools,
        messages: [],
      },
      getApiKey: (provider: string) => getApiKeySync(provider),
    });
    return { agent, model };
  }

  /**
   * Handle agent events and convert to ACP events
   */
  private handleAgentEvent(event: AgentEvent): void {
    // Event handling is done in runTurn via the eventCallback
    log.debug({ eventType: event.type }, "Agent event received");
  }

  /**
   * Ensure session exists
   */
  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    const sessionKey = input.sessionKey || `acp:${randomUUID()}`;
    const agent = input.agent || "main";
    const mode = input.mode || "persistent";

    // Load existing messages or create new session
    let messages: AgentMessage[] = [];
    try {
      messages = await this.sessionStore.load(sessionKey);
    } catch {
      // Session doesn't exist yet
    }

    // Create session metadata
    const meta: SessionAcpMeta = {
      backend: "local",
      agent,
      runtimeSessionName: sessionKey,
      mode,
      state: "idle",
      lastActivityAt: Date.now(),
      cwd: input.cwd,
    };

    this.sessions.set(sessionKey, {
      meta,
      messages,
    });

    return {
      sessionKey,
      backend: "local",
      runtimeSessionName: sessionKey,
      cwd: input.cwd,
    };
  }

  /**
   * Run a turn - streams events by using the agent
   */
  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (!session) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"),
        `Session ${input.handle.sessionKey} not found`
      );
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    session.abortController = abortController;

    // Update session state
    session.meta.state = "running";
    session.meta.lastActivityAt = Date.now();

    // Create event queue for this turn
    const eventQueue: AcpRuntimeEvent[] = [];
    let resolveNextEvent: ((event: AcpRuntimeEvent | null) => void) | null = null;
    let eventError: Error | null = null;

    const getNextEvent = async (): Promise<AcpRuntimeEvent | null> => {
      return new Promise((resolve) => {
        if (eventQueue.length > 0) {
          resolve(eventQueue.shift()!);
        } else if (eventError) {
          resolve(null);
        } else {
          resolveNextEvent = resolve;
        }
      });
    };

    const pushEvent = (event: AcpRuntimeEvent): void => {
      if (resolveNextEvent) {
        const resolve = resolveNextEvent;
        resolveNextEvent = null;
        resolve(event);
      } else {
        eventQueue.push(event);
      }
    };

    // Set up abort signal handler
    input.signal?.addEventListener("abort", () => {
      abortController.abort();
      this.agent.abort();
    });

    try {
      // Load session messages into agent (transcript hygiene aligned with main AgentService)
      let loaded = cleanTrailingErrors(session.messages);
      loaded = tryApplySessionTranscriptHygiene(loaded, this.agentModel);
      this.agent.replaceMessages(loaded);

      // Yield initial status
      yield {
        type: "status" as const,
        text: "Processing...",
      };

      // Build user message
      const messageContent: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

      if (input.text.trim()) {
        messageContent.push({ type: "text", text: input.text });
      }

      // Handle attachments
      if (input.attachments) {
        for (const att of input.attachments) {
          if (att.mediaType.startsWith("image/")) {
            messageContent.push({ type: "image", data: att.data, mimeType: att.mediaType });
          } else {
            messageContent.push({
              type: "text",
              text: `[File: ${att.mediaType}]`,
            });
          }
        }
      }

      const userMessage: AgentMessage = {
        role: "user",
        content: messageContent,
        timestamp: Date.now(),
      };

      // Process with agent and collect events
      let accumulatedText = "";
      let currentToolCallId: string | null = null;
      let currentToolName: string | null = null;
      let currentToolInput: Record<string, unknown> = {};

      // Subscribe to events during this turn
      const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
        try {
          switch (event.type) {
            case "agent_start": {
              pushEvent({
                type: "status",
                text: "Agent starting...",
              });
              break;
            }

            case "turn_start": {
              pushEvent({
                type: "status",
                text: "Processing request...",
              });
              break;
            }

            case "message_start": {
              pushEvent({
                type: "status",
                text: "Generating response...",
              });
              break;
            }

            case "message_update": {
              const msgEvent = event as any;
              if (msgEvent.message?.role === "assistant") {
                const content = msgEvent.message.content;
                const text = Array.isArray(content)
                  ? extractTextContent(content as Array<{ type: string; text?: string }>)
                  : String(content);

                // Yield text delta
                if (text.length > accumulatedText.length) {
                  const delta = text.slice(accumulatedText.length);
                  accumulatedText = text;

                  // Split into chunks for streaming
                  const chunks = this.chunkText(delta, 50);
                  for (const chunk of chunks) {
                    pushEvent({
                      type: "text_delta",
                      text: chunk,
                      stream: "output",
                    });
                  }
                }
              }
              break;
            }

            case "tool_execution_start": {
              const toolEvent = event as any;
              currentToolCallId = toolEvent.toolCallId || randomUUID();
              currentToolName = toolEvent.toolName || "unknown";
              // Note: pi-agent-core uses 'args' not 'input'
              currentToolInput = (toolEvent.args as Record<string, unknown>) || {};

              pushEvent({
                type: "tool_call",
                text: `Calling tool: ${currentToolName}`,
                toolCallId: currentToolCallId,
                status: "start",
                title: currentToolName,
                input: currentToolInput,
              });
              break;
            }

            case "tool_execution_update": {
              const toolEvent = event as any;
              if (currentToolCallId) {
                const progressText = toolEvent.partialResult || toolEvent.content || "...";
                pushEvent({
                  type: "tool_call",
                  text: progressText,
                  toolCallId: currentToolCallId,
                  status: "progress",
                  title: currentToolName || undefined,
                  input: currentToolInput,
                });
              }
              break;
            }

            case "tool_execution_end": {
              const toolEvent = event as any;
              if (currentToolCallId && currentToolName) {
                const isError = toolEvent.isError === true;
                let resultText = "";
                let hasError = isError;

                const result = toolEvent.result;
                if (result && typeof result === "object") {
                  // Handle different result formats
                  const resultObj = result as Record<string, unknown>;
                  if (resultObj.content && Array.isArray(resultObj.content)) {
                    for (const item of resultObj.content) {
                      if (item && typeof item === "object") {
                        const itemObj = item as Record<string, unknown>;
                        if (itemObj.type === "text") {
                          resultText = String(itemObj.text || "");
                        } else if (itemObj.type === "error") {
                          resultText = String(itemObj.error || "Tool execution failed");
                          hasError = true;
                        }
                      }
                    }
                  } else if (resultObj.error) {
                    resultText = String(resultObj.error);
                    hasError = true;
                  } else if (resultObj.message) {
                    resultText = String(resultObj.message);
                  }
                } else if (typeof result === "string") {
                  resultText = result;
                }

                if (!resultText) {
                  resultText = hasError ? "Tool execution failed" : "Tool executed successfully";
                }

                pushEvent({
                  type: "tool_call",
                  text: resultText,
                  toolCallId: currentToolCallId,
                  status: hasError ? "error" : "end",
                  title: currentToolName,
                  input: currentToolInput,
                  output: resultText,
                  error: hasError ? resultText : undefined,
                });
              }
              currentToolCallId = null;
              currentToolName = null;
              currentToolInput = {};
              break;
            }

            case "message_end": {
              pushEvent({
                type: "status",
                text: "Complete",
              });
              break;
            }

            case "turn_end": {
              // Turn complete
              break;
            }

            case "agent_end": {
              // Agent done
              break;
            }
          }
        } catch (err) {
          log.error({ err, eventType: event.type }, "Error handling agent event");
          eventError = err instanceof Error ? err : new Error(String(err));
        }
      });

      try {
        // Send prompt to agent
        await this.agent.prompt(userMessage);

        // Wait for agent to finish
        await this.agent.waitForIdle();

        // Collect remaining events from queue
        while (eventQueue.length > 0 || resolveNextEvent) {
          const event = await getNextEvent();
          if (event) {
            yield event;
          } else {
            break;
          }
        }

        // Save session messages
        const { messages: sanitized } = sanitizeMessages(this.agent.state.messages);
        const persisted = tryApplySessionTranscriptHygiene(sanitized, this.agentModel);
        session.messages = [...persisted];
        await this.sessionStore.save(input.handle.sessionKey, persisted);

      } finally {
        unsubscribe();
      }

      // Yield done
      yield {
        type: "done",
        stopReason: "done",
      };

      // Update session state
      session.meta.state = "idle";
      session.meta.lastActivityAt = Date.now();

    } catch (error) {
      session.meta.state = "error";
      session.meta.lastError = error instanceof Error ? error.message : String(error);

      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };

      throw error;
    }
  }

  /**
   * Execute a tool
   */
  private async executeTool(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool not found: ${toolName}` }],
        details: {},
      };
    }

    try {
      const toolCallId = randomUUID();
      const result = await tool.execute(toolCallId, toolInput);
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }
  }

  /**
   * Get runtime capabilities
   */
  async getCapabilities(_input?: { handle?: AcpRuntimeHandle }): Promise<AcpRuntimeCapabilities> {
    const toolNames = this.tools.map((t) => t.name);

    return {
      controls: [
        "session/set_mode",
        "session/set_config_option",
        "session/status",
        "session/reset",
      ],
      configOptionKeys: ["model", "temperature", "maxTokens"],
      toolNames: toolNames.length > 0 ? toolNames : undefined,
    };
  }

  /**
   * Get session status
   */
  async getStatus(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (!session) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"),
        `Session ${input.handle.sessionKey} not found`
      );
    }

    // Get token estimate if available
    let tokenEstimate = 0;
    try {
      const estimate = await this.sessionStore.estimateTokenUsage(input.handle.sessionKey, session.messages);
      tokenEstimate = estimate;
    } catch {
      // Ignore estimation errors
    }

    return {
      summary: `Session: ${input.handle.runtimeSessionName}, Agent: ${session.meta.agent}, State: ${session.meta.state}, Messages: ${session.messages.length}`,
      details: {
        mode: session.meta.mode,
        cwd: session.meta.cwd,
        lastActivityAt: session.meta.lastActivityAt,
        messageCount: session.messages.length,
        tokenEstimate,
        state: session.meta.state,
        lastError: session.meta.lastError,
      },
    };
  }

  /**
   * Set session mode
   */
  async setMode(input: { handle: AcpRuntimeHandle; mode: string }): Promise<void> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (session) {
      const validModes = ["persistent", "oneshot"];
      if (validModes.includes(input.mode)) {
        session.meta.mode = input.mode as "persistent" | "oneshot";
        log.info({ sessionKey: input.handle.sessionKey, mode: input.mode }, "Session mode changed");
      } else {
        throw new AcpRuntimeError(
          normalizeAcpErrorCode("ACP_INVALID_INPUT"),
          `Invalid mode: ${input.mode}. Valid modes: ${validModes.join(", ")}`
        );
      }
    }
  }

  /**
   * Set config option
   */
  async setConfigOption(input: { handle: AcpRuntimeHandle; key: string; value: string }): Promise<void> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (!session) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"),
        `Session ${input.handle.sessionKey} not found`
      );
    }

    // Store config in runtimeOptions
    if (!session.meta.runtimeOptions) {
      session.meta.runtimeOptions = {};
    }

    switch (input.key) {
      case "model":
      case "temperature":
      case "maxTokens":
        session.meta.runtimeOptions[input.key] = input.value;
        log.info({ sessionKey: input.handle.sessionKey, key: input.key, value: input.value }, "Config option set");
        break;
      default:
        log.warn({ key: input.key }, "Unknown config option key");
    }
  }

  /**
   * Reset session - clears message history
   */
  async resetSession(input: { handle: AcpRuntimeHandle }): Promise<void> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (!session) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"),
        `Session ${input.handle.sessionKey} not found`
      );
    }

    // Clear messages
    session.messages = [];
    
    // Clear agent messages
    this.agent.replaceMessages([]);

    // Delete from session store
    try {
      await this.sessionStore.delete(input.handle.sessionKey);
    } catch {
      // Ignore if not found
    }

    // Reset state
    session.meta.state = "idle";
    session.meta.lastActivityAt = Date.now();
    session.meta.lastError = undefined;

    log.info({ sessionKey: input.handle.sessionKey }, "Session reset");
  }

  /**
   * Health check
   */
  async doctor(): Promise<AcpRuntimeDoctorReport> {
    return {
      ok: true,
      message: "Local runtime is healthy",
    };
  }

  /**
   * Cancel current operation
   */
  async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (session?.abortController) {
      session.abortController.abort();
    }
    this.agent.abort();
    session.meta.state = "idle";
  }

  /**
   * Close session
   */
  async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
    const session = this.sessions.get(input.handle.sessionKey);
    if (session) {
      if (session.abortController) {
        session.abortController.abort();
      }
      // Save messages before closing
      if (session.messages.length > 0) {
        await this.sessionStore.save(input.handle.sessionKey, session.messages);
      }
      this.sessions.delete(input.handle.sessionKey);
    }
  }

  /**
   * Split text into chunks
   */
  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

/**
 * Create a local ACP runtime backend
 */
export function createLocalAcpRuntimeBackend(
  agentService: any, // AgentService - kept for compatibility but not directly used
  bus: MessageBus,
  config?: LocalRuntimeConfig
): { id: string; runtime: AcpRuntime; healthy: () => boolean } {
  const runtime = new LocalAcpRuntime(bus, config);

  return {
    id: "local",
    runtime,
    healthy: () => true,
  };
}
