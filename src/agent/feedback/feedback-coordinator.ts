/**
 * Feedback Coordinator - Coordinates all feedback mechanisms
 *
 * Unifies progress feedback, stream updates, and direct messages
 * into a single coherent feedback system.
 */

import type { MessageBus } from '../../infra/bus/index.js';
import type { SessionContext } from '../session/session-context.js';
import type { ProgressFeedbackManager, ProgressStage, ProgressMessage } from '../lifecycle/progress.js';
import type { StreamHandle } from '../messaging/stream-manager.js';
import { formatProgressMessage, formatHeartbeatMessage } from '../lifecycle/progress.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('FeedbackCoordinator');

export interface FeedbackCoordinatorConfig {
  progressManager: ProgressFeedbackManager;
  bus: MessageBus;
}

export class FeedbackCoordinator {
  private progressManager: ProgressFeedbackManager;
  private bus: MessageBus;
  private currentStreamHandle: StreamHandle | null = null;
  private currentContext: SessionContext | null = null;

  constructor(config: FeedbackCoordinatorConfig) {
    this.progressManager = config.progressManager;
    this.bus = config.bus;
  }

  /**
   * Set the current context for feedback
   */
  setContext(context: SessionContext): void {
    this.currentContext = context;
  }

  /**
   * Clear the current context
   */
  clearContext(): void {
    this.currentContext = null;
  }

  /**
   * Start a task and initialize feedback
   */
  startTask(): void {
    this.progressManager.startTask();
  }

  /**
   * End a task and cleanup feedback
   */
  endTask(): void {
    this.progressManager.endTask();
    this.clearStreamHandle();
  }

  /**
   * Set the stream handle for progress updates
   */
  setStreamHandle(handle: StreamHandle): void {
    this.currentStreamHandle = handle;
    
    if (handle) {
      // Setup callbacks to send progress via stream
      this.progressManager.setCallbacks({
        onProgress: (msg) => this.sendProgressMessage(msg),
        onStreamStart: (toolName, toolArgs) => {
          const stage = this.getToolStage(toolName);
          if (this.currentStreamHandle?.setProgress) {
            let detail: string | undefined;
            if (toolArgs.path) {
              detail = String(toolArgs.path);
            } else if (toolArgs.command) {
              const cmd = String(toolArgs.command);
              detail = cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd;
            }
            this.currentStreamHandle.setProgress(stage, detail);
          }
        },
        onStreamEnd: () => {
          if (this.currentStreamHandle?.setProgress) {
            this.currentStreamHandle.setProgress('idle');
          }
        },
        onHeartbeat: (elapsedMs, stage) => {
          this.sendHeartbeat(elapsedMs, stage);
        },
      });
    }
  }

  /**
   * Clear the stream handle
   */
  clearStreamHandle(): void {
    this.currentStreamHandle = null;
  }

  /**
   * Send progress message via stream or direct message
   */
  private async sendProgressMessage(msg: ProgressMessage): Promise<void> {
    if (!this.currentContext) return;

    // Try stream update first
    if (this.currentStreamHandle?.updateProgress && msg.stage !== 'idle') {
      this.currentStreamHandle.updateProgress('', msg.stage as ProgressStage, msg.message);
    } else if (msg.type === 'error') {
      // Send error as direct message
      const formatted = formatProgressMessage(msg);
      await this.bus.publishOutbound({
        channel: this.currentContext.channel,
        chat_id: this.currentContext.chatId,
        content: formatted,
        type: 'message',
      });
    }
  }

  /**
   * Send heartbeat for long-running tasks
   */
  private async sendHeartbeat(elapsedMs: number, stage: ProgressStage): Promise<void> {
    if (!this.currentContext) return;

    log.info({ elapsedMs, stage }, 'Progress heartbeat');

    const formatted = formatHeartbeatMessage(elapsedMs, stage);
    await this.bus.publishOutbound({
      channel: this.currentContext.channel,
      chat_id: this.currentContext.chatId,
      content: formatted,
      type: 'message',
    });
  }

  /**
   * Map tool name to progress stage
   */
  private getToolStage(toolName: string): ProgressStage {
    const name = toolName.toLowerCase();
    if (name.includes('read') || name.includes('file')) return 'reading';
    if (name.includes('search') || name.includes('grep') || name.includes('web')) return 'searching';
    if (name.includes('write') || name.includes('edit')) return 'writing';
    if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return 'executing';
    return 'executing';
  }

  /**
   * Update progress via stream
   */
  updateProgress(text: string, stage: ProgressStage, detail?: string): void {
    if (this.currentStreamHandle?.updateProgress) {
      this.currentStreamHandle.updateProgress(text, stage, detail);
    }
  }

  /**
   * Set progress stage
   */
  setProgress(stage: ProgressStage, detail?: string): void {
    if (this.currentStreamHandle?.setProgress) {
      this.currentStreamHandle.setProgress(stage, detail);
    }
  }

  /**
   * Send a direct message to the current context
   */
  async sendMessage(content: string): Promise<void> {
    if (!this.currentContext) {
      log.warn('No context available for sending message');
      return;
    }

    await this.bus.publishOutbound({
      channel: this.currentContext.channel,
      chat_id: this.currentContext.chatId,
      content,
      type: 'message',
    });
  }

  /**
   * Get the progress manager instance
   */
  getProgressManager(): ProgressFeedbackManager {
    return this.progressManager;
  }
}
