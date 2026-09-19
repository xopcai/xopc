import { useState } from 'react';

import { t } from '../i18n';
import type {
  BrowserChatMessage,
  BrowserThinkingBlock,
  BrowserToolBlock,
} from './chat-message-model';

type ActivityDetail = 'off' | 'on' | 'stream';

function toolStatusLabel(tool: BrowserToolBlock): string {
  if (tool.status === 'running') return t('toolRunning');
  if (tool.status === 'error') return t('toolFailed');
  return t('toolCompleted');
}

function toolDuration(tool: BrowserToolBlock): string {
  if (tool.startedAt === undefined || tool.completedAt === undefined) return '';
  const milliseconds = Math.max(0, tool.completedAt - tool.startedAt);
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function AssistantActivity({
  message,
  detail,
  streaming,
}: {
  message: BrowserChatMessage;
  detail: ActivityDetail;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(streaming && detail === 'stream');
  const blocks = message.blocks.filter((block): block is BrowserThinkingBlock | BrowserToolBlock => (
    block.type === 'tool' || (block.type === 'thinking' && detail !== 'off')
  ));
  if (!blocks.length) return null;
  const toolCount = blocks.filter((block) => block.type === 'tool').length;
  const running = blocks.some((block) => block.type === 'thinking' && block.streaming || block.type === 'tool' && block.status === 'running');
  const summary = running
    ? t('activityRunning')
    : toolCount > 0 ? t('activitySteps', String(toolCount)) : t('activityThoughts');

  return (
    <details className="assistant-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className={`activity-status${running ? ' running' : ''}`} />
        <span>{summary}</span>
      </summary>
      <div className="activity-list">
        {blocks.map((block, index) => block.type === 'thinking' ? (
          <div className="activity-thinking" key={`thinking:${index}`}>
            <strong>{block.streaming ? t('thinkingRunning') : t('thinking')}</strong>
            {block.text ? <p>{block.text}</p> : null}
          </div>
        ) : (
          <div className={`activity-tool ${block.status}`} key={block.toolCallId}>
            <span className="tool-status-mark" />
            <span className="tool-name">{block.name}</span>
            {block.activity?.count !== undefined ? <small>{block.activity.count}</small> : null}
            {toolDuration(block) ? <small>{toolDuration(block)}</small> : null}
            <small>{toolStatusLabel(block)}</small>
          </div>
        ))}
      </div>
    </details>
  );
}
