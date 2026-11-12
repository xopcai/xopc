const bundledChannelExtensionIds = new Set(['telegram', 'feishu-tools', 'weixin', 'dingtalk', 'wecom', 'slack', 'discord']);

export function isBundledChannelExtension(extensionId: string): boolean {
  return bundledChannelExtensionIds.has(extensionId);
}
