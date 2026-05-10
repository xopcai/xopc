/** Channels that use ~/.xopc/credentials pairing + allowFrom files (aligned with Feishu layout). */
export type StandardPairingChannel = 'telegram' | 'feishu' | 'dingtalk';

export type PairingCliChannel = StandardPairingChannel | 'weixin';
