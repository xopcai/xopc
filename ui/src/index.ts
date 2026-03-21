import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core';

// Import styles (tokens + Tailwind first, then app components)
import './styles.css';
import './styles/app/index.css';

import './components/MessageEditor';
import './components/MessageList';
import './components/AttachmentTile';
import './dialogs/AttachmentOverlay';
import './chat/ChatPanel.js';
import './app';
import { i18n } from './utils/i18n';
import type { Attachment } from './utils/attachment-utils';
import type { MessageEditor } from './components/MessageEditor';
import { normalizeAgentMessages } from './messages/agent-messages.js';

// Utils
export { t, i18n, setLanguage, getCurrentLanguage, initI18n, type Language } from './utils/i18n';
export type { Attachment } from './utils/attachment-utils';
export { formatUsage, formatTokenCount, formatCost } from './utils/format';
export { getIcon, loadIcon, getDocumentIcon } from './utils/icons';
export { loadAttachment, formatFileSize, getFileIcon } from './utils/attachment-utils';

// Components
export { MessageEditor } from './components/MessageEditor';
export {
  MessageList,
  MessageBubble,
  AttachmentRenderer,
  UsageBadge,
} from './components/index';
export type {
  Attachment as MessageAttachment,
  Message as UIMessage,
  MessageContent,
} from './components/MessageList/types';
export type {
  ToolRenderer,
  ToolRenderResult,
  ToolResultMessage,
  ToolContentPart,
} from './tools/index.js';
export {
  renderTool,
  renderToolToHtml,
  registerToolRenderer,
  setShowJsonMode,
  getToolRenderer,
  toolRenderers,
  renderHeader,
  renderCollapsibleHeader,
  DefaultRenderer,
  BashRenderer,
  stringToToolResultMessage,
  extractTextFromToolResult,
} from './tools/index.js';
export { ArtifactElement, ImageArtifact, MarkdownArtifact } from './tools/artifacts/index.js';

// Dialogs
export { XopcbotSettings, type SettingsSection, type SettingsField, type SettingsValue } from './dialogs/SettingsDialog';

// Chat Panel
export { ChatPanel } from './chat/index.js';
export type {
  GatewayClientConfig,
  ChatPayload,
  ErrorPayload,
  Message,
  ProgressState,
  ConnectionState,
  SessionInfo,
} from './chat/index.js';

// App
export { XopcbotApp, type Tab, type AppSettings } from './app';

@customElement('xopcbot-chat')
export class XopcbotChat extends LitElement {
  @property({ attribute: false }) agent?: Agent;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;

  private _autoScroll = true;
  private _lastScrollTop = 0;
  private _lastClientHeight = 0;
  private _scrollContainer?: HTMLElement;
  private _resizeObserver?: ResizeObserver;
  private _unsubscribeSession?: () => void;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = 'flex';
    this.style.flexDirection = 'column';
    this.style.height = '100%';
    this.style.minHeight = '0';

    this.setupSessionSubscription();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._scrollContainer?.removeEventListener('scroll', this._handleScroll);
    this._unsubscribeSession?.();
  }

  private setupSessionSubscription(): void {
    if (this._unsubscribeSession) {
      this._unsubscribeSession();
    }
    if (!this.agent) return;

    this._unsubscribeSession = this.agent.subscribe(async (ev: AgentEvent) => {
      switch (ev.type) {
        case 'message_start':
        case 'message_end':
        case 'turn_start':
        case 'turn_end':
        case 'agent_start':
          this.requestUpdate();
          break;
        case 'agent_end':
          this.requestUpdate();
          break;
        case 'message_update':
          this.requestUpdate();
          break;
      }
    });
  }

  private _handleScroll = (): void => {
    if (!this._scrollContainer) return;

    const currentScrollTop = this._scrollContainer.scrollTop;
    const scrollHeight = this._scrollContainer.scrollHeight;
    const clientHeight = this._scrollContainer.clientHeight;
    const distanceFromBottom = scrollHeight - currentScrollTop - clientHeight;

    if (clientHeight < this._lastClientHeight) {
      this._lastClientHeight = clientHeight;
      return;
    }

    if (currentScrollTop !== 0 && currentScrollTop < this._lastScrollTop && distanceFromBottom > 50) {
      this._autoScroll = false;
    } else if (distanceFromBottom < 10) {
      this._autoScroll = true;
    }

    this._lastScrollTop = currentScrollTop;
    this._lastClientHeight = clientHeight;
  };

  public setInput(text: string, attachments?: Attachment[]): void {
    if (this._messageEditor) {
      this._messageEditor.value = text;
      this._messageEditor.attachments = attachments || [];
    }
  }

  public setAutoScroll(enabled: boolean): void {
    this._autoScroll = enabled;
  }

  public async sendMessage(input: string, attachments?: Attachment[]): Promise<void> {
    if ((!input.trim() && attachments?.length === 0) || this.agent?.state.isStreaming) return;
    if (!this.agent) throw new Error('No agent set');
    if (!this.agent.state.model) throw new Error('No model set');

    this._messageEditor.value = '';
    this._messageEditor.attachments = [];
    this._autoScroll = true;

    if (attachments && attachments.length > 0) {
      const imageContents = attachments
        .filter((att) => att.mimeType.startsWith('image/'))
        .map((att) => ({
          type: 'image' as const,
          mimeType: att.mimeType,
          data: att.content,
        }));
      await this.agent.prompt(input, imageContents);
    } else {
      await this.agent.prompt(input);
    }
  }

  private renderMessages(): unknown {
    if (!this.agent) {
      return html`<div class="p-4 text-center text-muted-foreground">${i18n('No session available')}</div>`;
    }

    const state = this.agent.state;
    const messages = normalizeAgentMessages(this.agent.state.messages as unknown[]);
    return html`
      <message-list
        .messages=${messages}
        .isStreaming=${state.isStreaming}
        .useVirtualScroll=${false}
      ></message-list>
    `;
  }

  override render(): unknown {
    if (!this.agent) {
      return html`<div class="p-4 text-center text-muted-foreground">${i18n('No agent set')}</div>`;
    }

    const state = this.agent.state;
    return html`
      <div class="flex flex-col h-full bg-background text-foreground">
        <div class="flex-1 overflow-y-auto">
          <div class="max-w-3xl mx-auto p-4 pb-0">${this.renderMessages()}</div>
        </div>

        <div class="shrink-0">
          <div class="max-w-3xl mx-auto px-2">
            <message-editor
              .isStreaming=${state.isStreaming}
              .currentModel=${state.model}
              .thinkingLevel=${state.thinkingLevel}
              .showAttachmentButton=${this.enableAttachments}
              .showModelSelector=${this.enableModelSelector}
              .showThinkingSelector=${this.enableThinkingSelector}
              .onSend=${(input: string, attachments: Attachment[]) => this.sendMessage(input, attachments)}
              .onAbort=${() => this.agent?.abort()}
            ></message-editor>
          </div>
        </div>
      </div>
    `;
  }
}
