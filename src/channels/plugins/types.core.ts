/**
 * Core channel plugin surface (metadata and capabilities).
 */

export type ChannelId = string;

export type ChatType = 'direct' | 'group' | 'channel' | 'thread';

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  order?: number;
  aliases?: string[];
  systemImage?: string;
  showConfigured?: boolean;
  quickstartAllowFrom?: boolean;
  forceAccountBinding?: boolean;
  preferOver?: string[];
  /**
   * When true and the gateway uses HTTP lifecycle, `ChannelManager` skips `start()` for this
   * plugin until after the HTTP server is listening (OpenClaw-style: control plane first).
   */
  deferConnectUntilAfterListen?: boolean;
}

export interface ChannelCapabilities {
  chatTypes: Array<ChatType | 'thread'>;
  polls?: boolean;
  reactions: boolean;
  threads: boolean;
  media: boolean;
  nativeCommands: boolean;
  blockStreaming: boolean;
  edit?: boolean;
  unsend?: boolean;
  reply?: boolean;
  effects?: boolean;
  groupManagement?: boolean;
}
