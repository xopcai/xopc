export const BUNDLED_CHANNEL_EXTENSIONS = [
  { extensionId: 'telegram', channelId: 'telegram' },
  { extensionId: 'feishu-tools', channelId: 'feishu' },
  { extensionId: 'weixin', channelId: 'weixin' },
] as const;

export function isBundledChannelExtension(extensionId: string): boolean {
  return BUNDLED_CHANNEL_EXTENSIONS.some((entry) => entry.extensionId === extensionId);
}
