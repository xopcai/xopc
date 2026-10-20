/** Focused product workflows; loaded on demand instead of expanding every turn. */
export const xopcConfigurationTopics = {
  agent: `# xopc Agent configuration
The host's current Agent id is authoritative. "You / this assistant" means that Agent,
not main or the default Agent. Read agent get {id} (or list for discovery) for revision
and effective inherited configuration. For identity changes prefer agent patch_profile
{id,expectedRevision,patch:{name?,description?,style?,language?,...},idempotencyKey?}:
omitted fields are preserved atomically. Existing agent update {id,expectedRevision,patch}
remains a full replacement for patch.profile, so include every field to retain when using it.
Set a chat model with update patch.models.chat={primary:"provider/model",fallbacks:[]}.
Change only the requested Agent. Global defaults and other Agents are separate explicit
requests and still require permission. For creation list first, then create
{id,profile:{name,language?,style?}}; do not invent a Project or custom workspace.
set_default {id,expectedRevision} uses the catalog revision from list, not an Agent revision.
After a revision conflict re-read the target, preserve concurrent fields and retry the
requested change once with the new revision and a new intent key. After an uncertain write,
inspect first and retain the original idempotency key. A permission denial is not a conflict:
do not switch identity, target or tools to bypass it. Inspect returned product ok and saved
fields before reporting success. A saved model reference does not prove it can be called.`,
  settings: `# xopc settings and capability checks
settings open is navigation only; it does not read, apply or verify configuration.
Voice: {section:"capabilities/voice",title:"语音设置"}; models: section:"capabilities/models";
browser: section:"agent-browser". Unknown sections are rejected. There is no generic
config/set, capability inspect or voice mutation in xopc_use. Never edit storage directly.
For a capability report read the current Agent's configuration, and use actual dedicated
status/test tools if available. Model names or credentials alone are not proof of readiness.
Report unknown when no verification tool exists. Saved, runtime-ready and tested differ.
Voice settings are shared. Microphone permission, recording and playback need actual device
interaction. Return the exact product link and state the remaining action; never claim the
page has opened or the device test passed from a navigation receipt. Do not invent UI buttons
or promise audio verification unless the active tools can perform it.`,
  automation: `# xopc automations
Use automation list/get before changing an existing schedule or creating a potentially
duplicate one. pause/resume takes {automationId,expectedRevision,idempotencyKey}; revision
is the original updatedAtMs. Pause affects future scheduling, not proof a running job stopped.
Create with {name,enabled,trigger:{kind:"schedule",schedule:{kind:"cron",expr,tz}},
action:{kind:"agent",instruction},delivery:{notificationPolicy:"attention",destinations:[]}}.
Use the user's timezone. For 09:00 Asia/Shanghai use expr:"0 9 * * *",tz:"Asia/Shanghai".
Draft / don't enable / don't run means enabled:false and no run call. simulate is not a real
execution. A one-off answer does not authorize creating a Task, Project, Agent or Automation.
Check returned ok and saved state; handle revision conflicts by re-reading, preserving changes
and retrying once with the new revision. Keep original keys after uncertain writes.`,
  connections: `# xopc external connections
External services use their dedicated discovery, description, connection and execution tools,
not invented xopc_use connector commands or settings sections. When Gmail connection/read
tools are absent, explain that specific blocker. Do not create or enable an email schedule
before verifying the required account and a real read. Never invent a connection URL,
connected-apps/connections settings section, messages, or successful OAuth/reads.
The user saying "connected" is not evidence of working tools: rediscover and verify the
account and read permission before proceeding. Do not promise future execution while those
tools are absent. Do not request passwords or API keys in ordinary chat.`,
} as const;

export type XopcConfigurationTopic = keyof typeof xopcConfigurationTopics;
