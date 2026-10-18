import { NO_REPLY } from '../../messaging/no-reply.js';

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
    ...(params.hasSendMessage ? [`- After delivering your reply with \`send_message\`, respond only ${NO_REPLY} to avoid duplicates.`] : []),
  ].join('\n');
}

export function buildSilentRepliesSection(params: {
  isMinimal: boolean;
  silentReplyPromptMode?: 'generic' | 'none';
  hasSendMessage?: boolean;
}): string {
  if (params.isMinimal || params.silentReplyPromptMode === 'none') {
    return '';
  }
  return [
    '## Silent Replies',
    `Use ${NO_REPLY} only for background or system events needing no update${params.hasSendMessage ? ', or after delivering the reply with send_message' : ''}.`,
    'Always answer a direct message from a person, even if brief, unclear, repeated, or a test. Profile updates/tool results do not cancel it.',
    `The marker must be the entire message, without Markdown or other text.`,
  ].join('\n');
}

export function buildOutputDirectivesSection(isMinimal: boolean, toolNames: string[] = [], channels: string[] = []): string {
  const tools = new Set(toolNames.map(name => name.trim().toLowerCase()));
  const hasFiles = ['publish_artifacts', 'send_media', 'send_message'].some(name => tools.has(name));
  const hasVoice = tools.has('text_to_speech') || tools.has('send_media');
  const hasReplyTags = channels.some(channel => !['webchat', 'cli'].includes(channel));
  if (isMinimal || (!hasFiles && !hasReplyTags && !hasVoice)) {
    return '';
  }
  return [
    '## Assistant Output Directives',
    hasFiles ? 'Deliver attachments through available artifact or messaging tools using confirmed references. MEDIA:<path-or-url> and host paths do not publish files.' : '',
    hasVoice ? '`[[audio_as_voice]]` requests voice-note delivery for attached audio when supported.' : '',
    hasReplyTags ? 'For supported native replies, put [[reply_to_current]] first in the message. Use [[reply_to:<id>]] only for an explicitly supplied id. Tags are stripped on supported channels.' : '',
  ].filter(Boolean).join('\n');
}

export function buildTimeSection(timezone?: string, toolNames: string[] = []): string {
  const status = toolNames.find(name => name.trim().toLowerCase() === 'session_status')?.trim();
  if (!timezone) {
    return '';
  }
  return [
    '## Current Date & Time',
    `Time zone: ${timezone}`,
    '',
    status
      ? `For current date/time, use \`${status}\` or the inbound timestamp envelope.`
      : 'Use the inbound timestamp envelope for current date/time when present; otherwise verify with an available clock source rather than guessing.',
  ].join('\n');
}
