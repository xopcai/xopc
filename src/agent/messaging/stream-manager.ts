/**
 * Stream Manager - Manages stream handles for progress updates
 *
 * Handles creation and lifecycle of stream handles for sending progress updates
 * and streaming responses.
 */

import type { ProgressStage } from '../progress.js';

export interface StreamHandle {
  update: (text: string) => void;
  updateProgress?: (text: string, stage: ProgressStage, detail?: string) => void;
  setProgress?: (stage: ProgressStage, detail?: string) => void;
  end: () => Promise<void>;
  abort: () => Promise<void>;
  messageId: () => number | undefined;
  skipFinalOutbound?: () => boolean;
}

export class StreamManager {
  private currentHandle: StreamHandle | null = null;
  private skipFinalOutboundPending = false;

  /**
   * Set the current stream handle
   */
  setHandle(handle: StreamHandle): void {
    this.currentHandle = handle;
  }

  /**
   * Get the current stream handle
   */
  getHandle(): StreamHandle | null {
    return this.currentHandle;
  }

  /**
   * Clear the current stream handle
   */
  clearHandle(): void {
    this.currentHandle = null;
  }

  /**
   * Check if a stream handle is currently active
   */
  hasActiveHandle(): boolean {
    return this.currentHandle !== null;
  }

  /**
   * Update the stream with text content
   */
  update(text: string): void {
    this.currentHandle?.update(text);
  }

  /**
   * End the stream and clear the handle
   */
  async end(): Promise<void> {
    if (this.currentHandle) {
      const handle = this.currentHandle;
      await handle.end();
      this.skipFinalOutboundPending = handle.skipFinalOutbound?.() ?? false;
      this.clearHandle();
    } else {
      this.skipFinalOutboundPending = false;
    }
  }

  /**
   * Abort the stream and clear the handle
   */
  async abort(): Promise<void> {
    if (this.currentHandle) {
      await this.currentHandle.abort();
      this.skipFinalOutboundPending = false;
      this.clearHandle();
    }
  }

  /**
   * Whether the channel already delivered the final assistant text (e.g. Telegram streaming).
   * Consumes the flag for one outbound decision.
   */
  consumeSkipFinalOutbound(): boolean {
    const v = this.skipFinalOutboundPending;
    this.skipFinalOutboundPending = false;
    return v;
  }

  /**
   * Get the current message ID from the stream handle
   */
  getMessageId(): number | undefined {
    return this.currentHandle?.messageId();
  }

  /**
   * Update progress via the stream handle
   */
  updateProgress(text: string, stage: ProgressStage, detail?: string): void {
    if (this.currentHandle?.updateProgress) {
      this.currentHandle.updateProgress(text, stage, detail);
    }
  }

  /**
   * Set progress stage via the stream handle
   */
  setProgress(stage: ProgressStage, detail?: string): void {
    if (this.currentHandle?.setProgress) {
      this.currentHandle.setProgress(stage, detail);
    }
  }
}
