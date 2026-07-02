import enAgents from './en/agents.json' with { type: 'json' };
import enAutomations from './en/automations.json' with { type: 'json' };
import enApps from './en/apps.json' with { type: 'json' };
import enChannels from './en/channels.json' with { type: 'json' };
import enChat from './en/chat.json' with { type: 'json' };
import enCron from './en/cron.json' with { type: 'json' };
import enLogs from './en/logs.json' with { type: 'json' };
import enGoals from './en/goals.json' with { type: 'json' };
import enNotes from './en/notes.json' with { type: 'json' };
import enOnboarding from './en/onboarding.json' with { type: 'json' };
import enProviders from './en/providers.json' with { type: 'json' };
import enRemoteAccess from './en/remote-access.json' with { type: 'json' };
import enSessions from './en/sessions.json' with { type: 'json' };
import enSettings from './en/settings.json' with { type: 'json' };
import enShell from './en/shell.json' with { type: 'json' };
import enShares from './en/shares.json' with { type: 'json' };
import enTunnel from './en/tunnel.json' with { type: 'json' };
import enSkills from './en/skills.json' with { type: 'json' };
import enWorkflows from './en/workflows.json' with { type: 'json' };
import enWorkspace from './en/workspace.json' with { type: 'json' };

import zhAgents from './zh/agents.json' with { type: 'json' };
import zhAutomations from './zh/automations.json' with { type: 'json' };
import zhApps from './zh/apps.json' with { type: 'json' };
import zhChannels from './zh/channels.json' with { type: 'json' };
import zhChat from './zh/chat.json' with { type: 'json' };
import zhCron from './zh/cron.json' with { type: 'json' };
import zhLogs from './zh/logs.json' with { type: 'json' };
import zhGoals from './zh/goals.json' with { type: 'json' };
import zhNotes from './zh/notes.json' with { type: 'json' };
import zhOnboarding from './zh/onboarding.json' with { type: 'json' };
import zhProviders from './zh/providers.json' with { type: 'json' };
import zhRemoteAccess from './zh/remote-access.json' with { type: 'json' };
import zhSessions from './zh/sessions.json' with { type: 'json' };
import zhSettings from './zh/settings.json' with { type: 'json' };
import zhShell from './zh/shell.json' with { type: 'json' };
import zhShares from './zh/shares.json' with { type: 'json' };
import zhTunnel from './zh/tunnel.json' with { type: 'json' };
import zhSkills from './zh/skills.json' with { type: 'json' };
import zhWorkflows from './zh/workflows.json' with { type: 'json' };
import zhWorkspace from './zh/workspace.json' with { type: 'json' };

/** Full English message tree; assembled from `locales/en/*.json` fragments. */
export const en = {
  ...enAgents,
  ...enAutomations,
  ...enApps,
  ...enChannels,
  ...enChat,
  ...enCron,
  ...enLogs,
  ...enGoals,
  ...enNotes,
  ...enOnboarding,
  ...enProviders,
  ...enRemoteAccess,
  ...enSessions,
  ...enSettings,
  ...enShell,
  ...enShares,
  ...enTunnel,
  ...enSkills,
  ...enWorkflows,
  ...enWorkspace,
};

/** Full Chinese message tree; assembled from `locales/zh/*.json` fragments. */
export const zh = {
  ...zhAgents,
  ...zhAutomations,
  ...zhApps,
  ...zhChannels,
  ...zhChat,
  ...zhCron,
  ...zhLogs,
  ...zhGoals,
  ...zhNotes,
  ...zhOnboarding,
  ...zhProviders,
  ...zhRemoteAccess,
  ...zhSessions,
  ...zhSettings,
  ...zhShell,
  ...zhShares,
  ...zhTunnel,
  ...zhSkills,
  ...zhWorkflows,
  ...zhWorkspace,
};
