export type BindingRuleWire = {
  id?: string;
  agentId: string;
  priority?: number;
  enabled?: boolean;
  match: {
    channel: string;
    accountId?: string;
    peerKind?: string;
    peerId?: string;
    guildId?: string;
    teamId?: string;
    memberRoleIds?: string[];
  };
};

export type ChannelAgentRoutesState = {
  telegram: Record<string, string>;
  weixin: Record<string, string>;
  feishu: Record<string, string>;
};
