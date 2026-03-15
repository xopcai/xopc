/**
 * ACP Gateway Server - Full Implementation
 * 
 * CLI server that bridges ACP protocol to xopcbot's AgentService.
 * Implements the Agent interface from @agentclientprotocol/sdk.
 */

import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Agent } from "@agentclientprotocol/sdk";
import { loadConfig } from "../config/loader.js";
import { isMainModule } from "../infra/is-main.js";
import { AcpRuntimeError, normalizeAcpErrorCode } from "./runtime/errors.js";
import { getAcpSessionManager } from "./control-plane/manager.js";
// Re-export for Gateway integration
// import { registerAcpRuntimeBackend } from "./runtime/registry.js";
// import { createLocalAcpRuntimeBackend } from "./runtime/backends/local.js";
import type { AcpServerOptions } from "./types.js";
import type { AcpRuntimeEvent } from "./runtime/types.js";

// Maximum allowed prompt size (2MB)
const MAX_PROMPT_BYTES = 2 * 1024 * 1024;

/**
 * ACP Server State
 */
interface AcpServerState {
  activeSessionKey: string | null;
  sessions: Map<string, {
    agent: string;
    mode: "persistent" | "oneshot";
  }>;
}

/**
 * ACP Server - implements Agent interface from @agentclientprotocol/sdk
 * 
 * Note: Uses type casting to handle SDK type complexity
 */
class AcpServer implements Agent {
  private readonly state: AcpServerState = {
    activeSessionKey: null,
    sessions: new Map(),
  };
  private connection: AgentSideConnection | null = null;

  constructor(private readonly opts: AcpServerOptions = {}) {}

  /**
   * Set the connection (called by AgentSideConnection)
   */
  setConnection(conn: AgentSideConnection): void {
    this.connection = conn;
  }

  /**
   * Send session update notification to client
   */
  private async sendSessionUpdate(sessionId: string, update: any): Promise<void> {
    if (!this.connection) {
      return;
    }
    await this.connection.sessionUpdate({
      sessionId,
      update,
    });
  }

  // ============== Agent Interface Implementation ==============

  async initialize(params: any): Promise<any> {
    return {
      protocolVersion: params.protocolVersion || 1,
      agentCapabilities: {
        tools: true,
        multiModal: true,
        attachments: true,
        idle: true,
        commands: [
          { name: "session.reset", description: "Reset the session" },
          { name: "session.status", description: "Get session status" },
        ],
        envVars: true,
      },
      agentInfo: {
        name: "xopcbot-acp",
        version: "1.0.0",
      },
    };
  }

  async authenticate(_params: any): Promise<any> {
    // xopcbot uses Gateway-level auth, ACP layer is always authenticated
    return { authenticated: true };
  }

  async newSession(params: any): Promise<any> {
    const sessionKey = `acp:${randomUUID()}`;
    const agent = "main";
    const mode = "persistent";
    const cfg = loadConfig();
    
    try {
      const manager = getAcpSessionManager();
      await manager.initializeSession({
        cfg,
        sessionKey,
        agent,
        mode,
        cwd: params.cwd,
      });

      this.state.sessions.set(sessionKey, { agent, mode });
      this.state.activeSessionKey = sessionKey;

      return { 
        sessionId: sessionKey,
        configOptions: [],
      };
    } catch (error) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_INIT_FAILED"),
        error instanceof Error ? error.message : "Failed to create session"
      );
    }
  }

  async loadSession(params: any): Promise<any> {
    const sessionKey = params.sessionId;
    const cfg = loadConfig();
    
    try {
      const manager = getAcpSessionManager();
      const resolution = await manager.resolveSession({ cfg, sessionKey });

      if (resolution.kind !== "ready") {
        throw new AcpRuntimeError(normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"), `Session ${sessionKey} not found`);
      }

      this.state.activeSessionKey = sessionKey;
      return { 
        sessionId: sessionKey,
        configOptions: [],
      };
    } catch (error) {
      throw new AcpRuntimeError(
        normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"),
        error instanceof Error ? error.message : "Failed to load session"
      );
    }
  }

  async listSessions(_params: any): Promise<any> {
    return {
      sessions: Array.from(this.state.sessions.keys()).map((sessionId) => ({ 
        sessionId,
        cwd: "/tmp",
        title: sessionId,
        lastActiveAt: Date.now(),
      })),
    };
  }

  async prompt(params: any): Promise<any> {
    const sessionKey = params.sessionId || this.state.activeSessionKey;
    if (!sessionKey) {
      throw new AcpRuntimeError(normalizeAcpErrorCode("ACP_TURN_FAILED"), "No active session");
    }

    // Extract text from prompt blocks
    const text = this.extractTextFromPrompt(params.prompt);
    
    // Validate prompt size
    const promptBytes = Buffer.byteLength(text, "utf-8");
    if (promptBytes > MAX_PROMPT_BYTES) {
      throw new AcpRuntimeError(normalizeAcpErrorCode("ACP_PROMPT_TOO_LARGE"), `Prompt size ${promptBytes} exceeds maximum ${MAX_PROMPT_BYTES}`);
    }

    const cfg = loadConfig();
    const manager = getAcpSessionManager();

    // Get session status first
    const resolution = await manager.resolveSession({ cfg, sessionKey });
    if (resolution.kind !== "ready") {
      throw new AcpRuntimeError(normalizeAcpErrorCode("ACP_SESSION_NOT_FOUND"), `Session ${sessionKey} not found`);
    }

    // Run the turn with event callback for streaming updates
    const requestId = params.messageId || randomUUID();
    let stopReason = "end_turn";

    try {
      // Execute turn with onEvent callback for streaming
      await manager.runTurn({
        cfg,
        sessionKey,
        text,
        mode: "prompt",
        requestId,
        onEvent: async (event: AcpRuntimeEvent) => {
          await this.handleTurnEvent(sessionKey, event);
        },
      });
    } catch (error) {
      stopReason = "cancelled";
      await this.sendSessionUpdate(sessionKey, {
        agentMessageChunk: { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }] },
      });
    }

    return {
      stopReason,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  }

  /**
   * Handle turn event and send to client
   */
  private async handleTurnEvent(sessionKey: string, event: AcpRuntimeEvent): Promise<void> {
    switch (event.type) {
      case "text_delta": {
        const isThought = event.stream === "thought";
        if (isThought) {
          await this.sendSessionUpdate(sessionKey, {
            agentThoughtChunk: { content: [{ type: "text", text: event.text }] },
          });
        } else {
          await this.sendSessionUpdate(sessionKey, {
            agentMessageChunk: { content: [{ type: "text", text: event.text }] },
          });
        }
        break;
      }
      case "status": {
        await this.sendSessionUpdate(sessionKey, {
          agentMessageChunk: { content: [{ type: "text", text: event.text }] },
        });
        break;
      }
      case "tool_call": {
        const toolCallId = event.toolCallId || randomUUID();
        
        // Build tool call update based on status
        const toolCallUpdate: any = {
          toolCallId,
          kind: "interactive",
          name: event.title || "tool",
          input: event.input || {},
        };

        // Add output if available (for end/error status)
        if ((event.status === "end" || event.status === "error") && event.output) {
          toolCallUpdate.output = event.output;
        }

        // Add error info if status is error
        if (event.status === "error") {
          toolCallUpdate.error = event.error || "Tool execution failed";
        }

        await this.sendSessionUpdate(sessionKey, {
          toolCall: toolCallUpdate,
        });
        break;
      }
      case "error": {
        await this.sendSessionUpdate(sessionKey, {
          agentMessageChunk: { content: [{ type: "text", text: `Error: ${event.message}` }] },
        });
        break;
      }
      case "done": {
        break;
      }
    }
  }

  async cancel(params: any): Promise<void> {
    const sessionKey = params.sessionId || this.state.activeSessionKey;
    if (!sessionKey) {
      return;
    }

    const cfg = loadConfig();
    const manager = getAcpSessionManager();
    
    await manager.cancelSession({
      cfg,
      sessionKey,
      reason: "cancelled by client",
    });
  }

  // ============== Helpers ==============

  /**
   * Extract text content from prompt blocks
   */
  private extractTextFromPrompt(prompt: any[]): string {
    const texts: string[] = [];
    
    for (const block of prompt) {
      if (block.text && typeof block.text === "string") {
        texts.push(block.text);
      }
    }
    
    return texts.join("\n");
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): AcpServerOptions {
  const opts: AcpServerOptions = {};
  
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    
    if (arg === "--session") {
      opts.defaultSessionKey = args[i + 1];
      i += 1;
      continue;
    }
    
    if (arg === "--session-label") {
      opts.defaultSessionLabel = args[i + 1];
      i += 1;
      continue;
    }
    
    if (arg === "--require-existing") {
      opts.requireExistingSession = true;
      continue;
    }
    
    if (arg === "--reset-session") {
      opts.resetSession = true;
      continue;
    }
    
    if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
      continue;
    }
    
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  
  return opts;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`Usage: xopcbot acp serve [options]

ACP server for IDE integration.

Options:
  --session <key>         Default session key (e.g. "agent:main:main")
  --session-label <label> Default session label to resolve
  --require-existing      Fail if the session key/label does not exist
  --reset-session         Reset the session key before first use
  --verbose, -v           Verbose logging to stderr
  --help, -h              Show this help message
`);
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  // Set up stdio streams for ACP protocol
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);

  // Create ACP server and pass it to AgentSideConnection
  const server = new AcpServer(opts);
  
  // Set up connection when created
  new AgentSideConnection((conn: AgentSideConnection) => {
    server.setConnection(conn);
    return server as any;
  }, stream);

  // Keep process alive
  await new Promise(() => {});
}

// Run main
if (isMainModule({ currentFile: fileURLToPath(import.meta.url) })) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}

export { AcpServer };
