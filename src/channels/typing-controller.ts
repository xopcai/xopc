/**
 * Typing Controller - Manages Telegram typing indicators
 * 
 * Telegram requires sendChatAction to be called periodically (every ~5 seconds)
 * to maintain the typing status. This controller handles that automatically.
 */
export class TypingController {
  private intervals = new Map<string, NodeJS.Timeout>();
  private pendingStops = new Set<string>();
  private readonly typingIntervalMs = 5000;
  private readonly debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Start typing indicator for a chat
   * @param sendTyping - Function to send typing action
   * @param chatId - Chat identifier
   * @param threadId - Optional forum topic thread ID
   */
  async start(
    sendTyping: (threadId?: number) => Promise<void>,
    chatId: string,
    threadId?: number
  ): Promise<void> {
    const key = this.buildKey(chatId, threadId);

    // If already typing, don't start another interval
    if (this.intervals.has(key)) {
      this.pendingStops.delete(key);
      return;
    }

    try {
      // Send initial typing action
      await sendTyping(threadId);
    } catch (error) {
      console.error(`Failed to start typing for ${key}:`, error);
    }

    // Start periodic typing updates
    const interval = setInterval(async () => {
      // Check if this typing should stop
      if (this.pendingStops.has(key)) {
        this.pendingStops.delete(key);
        this.stopSync(chatId, threadId);
        return;
      }

      try {
        await sendTyping(threadId);
      } catch (error) {
        // Silently continue - typing failures shouldn't break the flow
      }
    }, this.typingIntervalMs);

    this.intervals.set(key, interval);

    if (this.debug) {
      console.debug(`[TypingController] Started typing for ${key}`);
    }
  }

  /**
   * Schedule typing to stop (will stop after the next interval tick)
   * Use this for async flows where you can't stop immediately
   */
  scheduleStop(chatId: string, threadId?: number): void {
    const key = this.buildKey(chatId, threadId);
    this.pendingStops.add(key);

    if (this.debug) {
      console.debug(`[TypingController] Scheduled stop for ${key}`);
    }
  }

  /**
   * Stop typing indicator immediately
   * @param chatId - Chat identifier
   * @param threadId - Optional forum topic thread ID
   */
  async stop(chatId: string, threadId?: number): Promise<void> {
    const key = this.buildKey(chatId, threadId);
    this.pendingStops.delete(key);
    this.stopSync(chatId, threadId);
  }

  /**
   * Synchronous stop (internal use)
   */
  private stopSync(chatId: string, threadId?: number): void {
    const key = this.buildKey(chatId, threadId);
    const interval = this.intervals.get(key);

    if (interval) {
      clearInterval(interval);
      this.intervals.delete(key);

      if (this.debug) {
        console.debug(`[TypingController] Stopped typing for ${key}`);
      }
    }
  }

  /**
   * Stop all typing indicators (cleanup)
   */
  stopAll(): void {
    for (const [key, interval] of this.intervals) {
      clearInterval(interval);
      if (this.debug) {
        console.debug(`[TypingController] Stopped all typing (key: ${key})`);
      }
    }
    this.intervals.clear();
    this.pendingStops.clear();
  }

  /**
   * Check if currently typing for a chat
   */
  isTyping(chatId: string, threadId?: number): boolean {
    const key = this.buildKey(chatId, threadId);
    return this.intervals.has(key);
  }

  /**
   * Build a unique key for a chat session
   */
  private buildKey(chatId: string, threadId?: number): string {
    return threadId !== undefined ? `${chatId}:${threadId}` : chatId;
  }
}
