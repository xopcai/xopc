const bundledChannelExtensionIds = new Set(['telegram', 'feishu-tools', 'weixin']);

export function isBundledChannelExtension(extensionId: string): boolean {
  return bundledChannelExtensionIds.has(extensionId);
}
