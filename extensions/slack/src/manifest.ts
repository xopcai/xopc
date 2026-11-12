/** Minimum permissions for direct messages and explicit channel mentions. */
export const slackAppManifest = {
  _metadata: { major_version: 1 },
  display_information: { name: 'xopc', description: 'Chat with your xopc Agent in Slack' },
  features: {
    bot_user: { display_name: 'xopc', always_online: false },
    app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
  },
  oauth_config: { scopes: { bot: ['app_mentions:read', 'chat:write', 'im:history'] } },
  settings: {
    event_subscriptions: { bot_events: ['app_mention', 'message.im'] },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
};
