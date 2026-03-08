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
}

export class StreamManager {
  private currentHandle: StreamHandle | null = null;

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
      await this.currentHandle.end();
      this.clearHandle();
    }
  }

  /**
   * Abort the stream and clear the handle
   */
  async abort(): Promise<void> {
    if (this.currentHandle) {
      await this.currentHandle.abort();
      this.clearHandle();
    }
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
