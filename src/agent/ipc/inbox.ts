import type { Config } from '../../config/schema.js';
import { DurableQueue } from '../../storage/sqlite/durable-queue.js';
import { createLogger } from '../../utils/logger.js';
import type { AgentIPCMessage } from './types.js';

const log = createLogger('AgentInbox');
const LEASE_MS = 30_000;

/** SQLite queue with acknowledgement after processing and renewable claims. */
export class AgentInbox {
  private readonly queue: DurableQueue<AgentIPCMessage>;
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;
  private stopped = true;

  constructor(agentId: string) { this.queue = new DurableQueue('agent-ipc', agentId); }

  static forAgent(_config: Config, agentId: string): AgentInbox { return new AgentInbox(agentId); }

  async enqueue(message: AgentIPCMessage): Promise<void> { this.queue.enqueue(message.id, message); }
  async peek(limit = 10): Promise<AgentIPCMessage[]> { return this.queue.pending(limit); }
  async count(): Promise<number> { return this.queue.pending().length; }
  async clearProcessed(olderThanMs?: number): Promise<number> { return this.queue.clearProcessed(olderThanMs); }

  async watch(handler: (msg: AgentIPCMessage) => Promise<void>): Promise<() => void> {
    this.stopWatching();
    this.stopped = false;
    const poll = () => this.processPending(handler).catch(err => {
      log.error({ err }, 'IPC queue processing failed');
    });
    await poll();
    if (!this.stopped) {
      this.timer = setInterval(() => { void poll(); }, 250);
      this.timer.unref();
    }
    return () => this.stopWatching();
  }

  stopWatching(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async processPending(handler: (msg: AgentIPCMessage) => Promise<void>): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const claim = this.queue.claim(LEASE_MS);
        if (!claim) break;
        const renewal = setInterval(() => {
          try { this.queue.renew(claim.id, claim.token, LEASE_MS); }
          catch (err) { log.error({ err, messageId: claim.id }, 'IPC lease renewal failed'); }
        }, LEASE_MS / 3);
        renewal.unref();
        let succeeded = false;
        try {
          await handler(claim.payload);
          succeeded = true;
        } catch (err) {
          log.error({ err, messageId: claim.id }, 'IPC handler failed; message remains pending');
        } finally {
          clearInterval(renewal);
          this.queue.finish(claim.id, claim.token, succeeded);
        }
        if (!succeeded) break;
      }
    } finally { this.processing = false; }
  }
}
