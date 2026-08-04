import { NO_REPLY } from '../../../heartbeat/tokens.js';

export function buildMessagingSection(params: {
  channels: string[];
  isMinimal: boolean;
  hasSendMessage: boolean;
}): string {
  if (params.isMinimal || params.channels.length === 0) {
    return '';
  }
  const channelList = params.channels.join(', ');
  const messageToolLine = params.hasSendMessage
    ? `- Use \`send_message\` for proactive sends + channel actions; provide \`channel\` and \`chat_id\` together for a cross-channel destination`
    : '- Outbound messaging tools are not available in this session';

  return [
    '## Messaging',
    `- Reply in current session → automatically routes to the source channel (${channelList})`,
    messageToolLine,
    `- If you use \`send_message\` to deliver your user-visible reply, respond with ONLY: ${NO_REPLY} (avoid duplicate replies)`,
  ].join('\n');
}

export function buildSilentRepliesSection(params: {
  isMinimal: boolean;
  silentReplyPromptMode?: 'generic' | 'none';
}): string {
  if (params.isMinimal || params.silentReplyPromptMode === 'none') {
    return '';
  }
  return [
    '## Silent Replies',
    `When you have nothing to say, respond with ONLY: ${NO_REPLY}`,
    '',
    'Rules:',
    '- It must be your ENTIRE message — nothing else',
    `- Never append it to an actual response (never include "${NO_REPLY}" in real replies)`,
    '- Never wrap it in markdown or code blocks',
    '',
    `Wrong: "Here's help... ${NO_REPLY}"`,
    `Right: ${NO_REPLY}`,
  ].join('\n');
}

export function buildOutputDirectivesSection(isMinimal: boolean): string {
  if (isMinimal) {
    return '';
  }
  return [
    '## Assistant Output Directives',
    'Use these when you need delivery metadata in an assistant message:',
    '- `MEDIA:<path-or-url>` on its own line requests attachment delivery. Supported clients strip MEDIA lines and render attachments inline; channels still decide actual delivery behavior.',
    '- `[[audio_as_voice]]` marks attached audio as a voice-note style delivery hint when supported.',
    '- To request a native reply/quote on supported surfaces, include one reply tag in your reply:',
    '- Reply tags must be the very first token in the message (no leading text/newlines): [[reply_to_current]] your reply.',
    '- [[reply_to_current]] replies to the triggering message.',
    '- Prefer [[reply_to_current]]. Use [[reply_to:<id>]] only when an id was explicitly provided.',
    'Supported tags are stripped before user-visible rendering; support still depends on the current channel config.',
  ].join('\n');
}

export function buildTimeSection(timezone?: string): string {
  if (!timezone) {
    return '';
  }
  return [
    '## Current Date & Time',
    `Time zone: ${timezone}`,
    '',
    'If you need the current date/time/day-of-week, use the `session_status` tool or the inbound message timestamp envelope (when present).',
  ].join('\n');
}

export function buildHeartbeatBehaviorSection(params: {
  enabled: boolean;
  customPrompt?: string;
  userTimezone?: string;
}): string {
  if (!params.enabled) {
    return '';
  }
  if (params.customPrompt?.trim()) {
    return `## Heartbeats\n\n${params.customPrompt.trim()}`;
  }
  let quietHoursNote = '';
  if (params.userTimezone) {
    quietHoursNote = `\n\n> Quiet hours: The user is in **${params.userTimezone}**. Avoid proactive checks during late night (23:00-08:00) unless urgent.`;
  }
  return [
    '## Heartbeats',
    '',
    'If the current user message is a heartbeat poll and nothing needs attention, reply exactly: HEARTBEAT_OK',
    '',
    'If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.',
    quietHoursNote.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}
