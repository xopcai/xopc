#!/usr/bin/env node

/**
 * Agent Runner - Entry point for subagent processes
 * 
 * This module is forked/spawned by the SubagentManager to run
 * a subagent in its own process.
 */

import { mkdir, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '../utils/logger.js';
import {
  resolveStateDir,
  resolveRunDir,
  resolvePidPath,
  resolveStatusPath,
  resolveAgentDir,
} from '../config/paths.js';
import { AgentSocketServer } from './ipc/socket.js';
import { AgentInbox } from './ipc/inbox.js';
import type { AgentIPCMessage } from './ipc/types.js';
import { createResponseMessage } from './ipc/types.js';

const log = createLogger('AgentRunner');

// ============================================
// Agent Instance
// ============================================

class AgentInstance {
  private agentId: string;
  private stateDir: string;
  private socketServer?: AgentSocketServer;
  private inbox?: AgentInbox;
  private shuttingDown = false;

  constructor(agentId: string, stateDir?: string) {
    this.agentId = agentId;
    this.stateDir = stateDir || resolveStateDir();
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    log.info({ agentId: this.agentId }, 'Starting agent');

    // Write PID file
    await this.writePidFile();

    // Write status
    await this.updateStatus('running');

    // Set up IPC
    await this.setupIPC();

    // Set up signal handlers
    this.setupSignalHandlers();

    log.info({ agentId: this.agentId }, 'Agent started');
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    log.info({ agentId: this.agentId }, 'Stopping agent');

    // Stop socket server
    await this.socketServer?.stop();

    // Update status
    await this.updateStatus('stopped');

    // Remove PID file
    await this.removePidFile();

    log.info({ agentId: this.agentId }, 'Agent stopped');
  }

  // ============================================
  // Private Methods
  // ============================================

  private async setupIPC(): Promise<void> {
    // Set up inbox (file-based IPC fallback)
    this.inbox = new AgentInbox(resolveAgentDir(this.agentId));

    // Start watching inbox for messages
    this.inbox.watch(async (msg) => {
      await this.handleMessage(msg);
    });

    // Set up socket server (primary IPC)
    this.socketServer = new AgentSocketServer(this.agentId);
    await this.socketServer.start(async (msg, reply) => {
      await this.handleMessage(msg, reply);
    });
  }

  private async handleMessage(
    msg: AgentIPCMessage,
    reply?: (response: AgentIPCMessage) => void
  ): Promise<void> {
    log.debug({ messageId: msg.id, type: msg.type, from: msg.from }, 'Received message');

    switch (msg.type) {
      case 'task':
        await this.handleTask(msg, reply);
        break;
      case 'query':
        await this.handleQuery(msg, reply);
        break;
      case 'signal':
        await this.handleSignal(msg);
        break;
      default:
        log.warn({ type: msg.type }, 'Unknown message type');
    }
  }

  private async handleTask(
    msg: AgentIPCMessage,
    reply?: (response: AgentIPCMessage) => void
  ): Promise<void> {
    const payload = msg.payload as { task: string; context?: string };

    log.info({ task: payload.task.slice(0, 100) }, 'Executing task');

    try {
      // TODO: Integrate with actual agent execution logic
      // For now, just echo the task back as the result
      const result = await this.executeTask(payload.task, payload.context);

      if (reply) {
        reply(
          createResponseMessage(this.agentId, msg.from, msg.id, true, result)
        );
      }
    } catch (error) {
      log.error({ error }, 'Task execution failed');

      if (reply) {
        reply(
          createResponseMessage(
            this.agentId,
            msg.from,
            msg.id,
            false,
            undefined,
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
  }

  private async handleQuery(
    msg: AgentIPCMessage,
    reply?: (response: AgentIPCMessage) => void
  ): Promise<void> {
    const payload = msg.payload as { query: string; queryType: string };

    log.debug({ query: payload.query, type: payload.queryType }, 'Handling query');

    // TODO: Implement query handling
    if (reply) {
      reply(
        createResponseMessage(this.agentId, msg.from, msg.id, true, {
          query: payload.query,
          result: 'Query not implemented',
        })
      );
    }
  }

  private async handleSignal(msg: AgentIPCMessage): Promise<void> {
    const payload = msg.payload as { signal: string };

    log.info({ signal: payload.signal }, 'Received signal');

    switch (payload.signal) {
      case 'STOP':
        await this.stop();
        process.exit(0);
        break;
      case 'PAUSE':
        // TODO: Implement pause
        break;
      case 'RESUME':
        // TODO: Implement resume
        break;
      case 'RELOAD':
        // TODO: Implement config reload
        break;
      case 'STATUS':
        // Status is already being tracked
        break;
    }
  }

  private async executeTask(task: string, _context?: string): Promise<string> {
    // TODO: This should integrate with the actual agent service
    // For now, just return a placeholder
    return `Task completed: ${task.slice(0, 100)}...`;
  }

  private async writePidFile(): Promise<void> {
    const pidPath = resolvePidPath(this.agentId);
    await mkdir(resolveRunDir(this.agentId), { recursive: true });
    await writeFile(pidPath, String(process.pid), 'utf-8');
  }

  private async removePidFile(): Promise<void> {
    const pidPath = resolvePidPath(this.agentId);
    if (existsSync(pidPath)) {
      await unlink(pidPath);
    }
  }

  private async updateStatus(status: string): Promise<void> {
    const statusPath = resolveStatusPath(this.agentId);
    await mkdir(resolveRunDir(this.agentId), { recursive: true });
    await writeFile(
      statusPath,
      JSON.stringify(
        {
          pid: process.pid,
          agentId: this.agentId,
          startedAt: new Date().toISOString(),
          status,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  private setupSignalHandlers(): void {
    process.on('SIGTERM', async () => {
      log.info('Received SIGTERM');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      log.info('Received SIGINT');
      await this.stop();
      process.exit(0);
    });

    process.on('uncaughtException', async (err) => {
      log.fatal({ err }, 'Uncaught exception');
      await this.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      log.fatal({ reason }, 'Unhandled rejection');
      await this.stop();
      process.exit(1);
    });
  }
}

// ============================================
// Entry Points
// ============================================

/**
 * Start agent from command line args
 */
export async function startAgent(agentId?: string): Promise<void> {
  const id = agentId || process.env.XOPCBOT_AGENT_ID;

  if (!id) {
    console.error('Agent ID required. Set XOPCBOT_AGENT_ID or pass as argument.');
    process.exit(1);
  }

  const instance = new AgentInstance(id);
  await instance.start();

  // Keep process alive
  setInterval(() => {}, 1000);
}

// If run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const agentId = process.argv[2] || process.env.XOPCBOT_AGENT_ID;
  startAgent(agentId).catch((err) => {
    console.error('Failed to start agent:', err);
    process.exit(1);
  });
}
