import { useState } from 'react';

import { t } from '../i18n';
import type {
  BrowserChatMessage,
  BrowserThinkingBlock,
  BrowserToolBlock,
} from './chat-message-model';
import { ChevronRightIcon } from './icons';

type ActivityDetail = 'off' | 'on' | 'stream';

function normalizedToolId(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_').split('__').at(-1)?.split('.').at(-1) ?? '';
}

function friendlyToolTitle(name: string): string | undefined {
  const id = normalizedToolId(name);
  if (id === 'browser_use') return t('toolLabelBrowser');
  if (id === 'web_search') return t('toolLabelWebSearch');
  if (id === 'web_fetch' || id === 'fetch_url') return t('toolLabelWebFetch');
  if (id === 'read_file' || id === 'read') return t('toolLabelReadFile');
  if (id === 'write_file' || id === 'write') return t('toolLabelWriteFile');
  if (id === 'edit_file' || id === 'edit') return t('toolLabelEditFile');
  if (id === 'exec' || id === 'bash' || id === 'shell' || id === 'run_command') return t('toolLabelCommand');
  if (id === 'computer_use') return t('toolLabelComputer');
  if (id === 'codemode') return t('toolLabelCode');
  if (id.includes('memory') || id.includes('knowledge') || id.includes('user_context')) return t('toolLabelMemory');
  if (id.includes('skill')) return t('toolLabelSkill');
  if (id.includes('session')) return t('toolLabelSession');
  if (id.includes('image')) return t('toolLabelImage');
  if (id === 'update_plan') return t('toolLabelPlan');
  return undefined;
}

function toolStatusLabel(tool: BrowserToolBlock): string {
  if (tool.status === 'running') return t('toolRunning');
  if (tool.status === 'error') return t('toolFailed');
  return t('toolCompleted');
}

function toolDuration(tool: BrowserToolBlock): string {
  if (tool.startedAt === undefined || tool.completedAt === undefined) return '';
  const milliseconds = Math.max(0, tool.completedAt - tool.startedAt);
  if (milliseconds === 0) return '';
  return milliseconds < 1_000 ? `${milliseconds} ms` : `${(milliseconds / 1_000).toFixed(1)} s`;
}

function formatPreviewValue(value: unknown, maxLength = 520): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  let text: string;
  if (typeof value === 'string') {
    text = value.trim();
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
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
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const blocks = message.blocks.filter((block): block is BrowserThinkingBlock | BrowserToolBlock => (
    block.type === 'tool' || (block.type === 'thinking' && detail !== 'off')
  ));
  if (!blocks.length) return null;
  const toolCount = blocks.filter((block) => block.type === 'tool').length;
  const running = blocks.some((block) => (
    (block.type === 'thinking' && block.streaming) || (block.type === 'tool' && block.status === 'running')
  ));
  const summary = running
    ? t('activityRunning')
    : toolCount === 1
      ? t('activityStepOne')
      : toolCount > 0 ? t('activitySteps', String(toolCount)) : t('activityThoughts');

  const toggleTool = (id: string) => {
    setExpandedTools((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <details className="assistant-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className={`activity-status${running ? ' running' : ''}`} />
        <span className="activity-summary-text">{summary}</span>
      </summary>
      <div className="activity-list">
        {blocks.map((block, index) => {
          if (block.type === 'thinking') {
            return (
              <div className="activity-thinking" key={`thinking:${index}`}>
                <strong>{block.streaming ? t('thinkingRunning') : t('thinking')}</strong>
                {block.text ? <p>{block.text}</p> : null}
              </div>
            );
          }
          const friendly = friendlyToolTitle(block.name);
          const inputPreview = formatPreviewValue(block.input);
          const resultPreview = formatPreviewValue(block.result);
          const hasDetails = Boolean(inputPreview || resultPreview);
          const expanded = Boolean(expandedTools[block.toolCallId]);
          const duration = toolDuration(block);
          return (
            <div className={`activity-tool-item ${block.status}`} key={block.toolCallId}>
              <div className={`activity-tool ${block.status}`}>
                <span className="tool-status-mark" />
                {hasDetails ? (
                  <button
                    type="button"
                    className="tool-row-toggle"
                    aria-expanded={expanded}
                    onClick={() => toggleTool(block.toolCallId)}
                  >
                    <ChevronRightIcon className={`tool-chevron${expanded ? ' expanded' : ''}`} />
                    <span className="tool-label-group">
                      {friendly ? <span className="tool-friendly">{friendly}</span> : null}
                      <span className="tool-name">{block.name}</span>
                    </span>
                  </button>
                ) : (
                  <span className="tool-label-group">
                    {friendly ? <span className="tool-friendly">{friendly}</span> : null}
                    <span className="tool-name">{block.name}</span>
                  </span>
                )}
                {block.activity?.count !== undefined ? <small className="tool-meta">{block.activity.count}</small> : null}
                {duration ? <small className="tool-meta">{duration}</small> : null}
                <small className={`tool-state ${block.status}`}>{toolStatusLabel(block)}</small>
              </div>
              {hasDetails && expanded ? (
                <div className="tool-detail-panel">
                  {inputPreview ? (
                    <div className="tool-detail-section">
                      <span>{t('toolInput')}</span>
                      <pre>{inputPreview}</pre>
                    </div>
                  ) : null}
                  {resultPreview ? (
                    <div className="tool-detail-section">
                      <span>{t('toolOutput')}</span>
                      <pre>{resultPreview}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}
