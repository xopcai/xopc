const bundledChannelExtensionIds = new Set(['telegram', 'feishu-tools', 'weixin', 'dingtalk', 'wecom']);

export function isBundledChannelExtension(extensionId: string): boolean {
  return bundledChannelExtensionIds.has(extensionId);
}
