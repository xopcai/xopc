/**
 * Optional per-account health tracking for channel runtimes.
 */

export interface ChannelHealthState {
  healthy: boolean;
  lastCheckAt?: number;
  detail?: string;
}

export class ChannelHealthMonitor {
  private state = new Map<string, ChannelHealthState>();

  set(channelId: string, accountId: string, next: ChannelHealthState): void {
    this.state.set(`${channelId}:${accountId}`, next);
  }

  get(channelId: string, accountId: string): ChannelHealthState | undefined {
    return this.state.get(`${channelId}:${accountId}`);
  }
}
