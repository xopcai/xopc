import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { Agent, type AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import './components/MessageEditor.js';
import './components/MessageList.js';
import './components/Messages.js';
import './components/StreamingMessageContainer.js';
import { i18n, setLanguage, translations } from './utils/i18n.js';
import type { Attachment } from './utils/attachment-utils.js';
import type { MessageEditor } from './components/MessageEditor.js';
import type { StreamingMessageContainer } from './components/StreamingMessageContainer.js';

export { i18n, setLanguage, translations } from './utils/i18n.js';
export type { Attachment } from './utils/attachment-utils.js';
export { formatUsage, formatTokenCount, formatCost } from './utils/format.js';
export { MessageEditor } from './components/MessageEditor.js';
export { MessageList } from './components/MessageList.js';
export type { MessageList as MessageListComponent } from './components/MessageList.js';
export { StreamingMessageContainer } from './components/StreamingMessageContainer.js';
export { XopcbotConfig, type ConfigSection, type ConfigField } from './dialogs/ConfigDialog.js';
export { XopcbotGatewayChat, type GatewayClientConfig } from './gateway-chat.js';

@customElement('xopcbot-chat')
export class XopcbotChat extends LitElement {
  @property({ attribute: false }) agent?: Agent;
  @property({ type: Boolean }) enableAttachments = true;
  @property({ type: Boolean }) enableModelSelector = true;
  @property({ type: Boolean }) enableThinkingSelector = true;

  @query('message-editor') private _messageEditor!: MessageEditor;
  @query('streaming-message-container') private _streamingContainer!: StreamingMessageContainer;

  private _autoScroll = true;
  private _lastScrollTop = 0;
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
          if (this._streamingContainer) {
            this._streamingContainer.isStreaming = false;
            this._streamingContainer.setMessage(null, true);
          }
          this.requestUpdate();
          break;
        case 'message_update':
          if (this._streamingContainer) {
            this._streamingContainer.isStreaming = this.agent?.state.isStreaming || false;
            this._streamingContainer.setMessage(ev.message, !this._streamingContainer.isStreaming);
          }
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
      await this.agent.prompt({
        role: 'user-with-attachments',
        content: input,
        attachments,
        timestamp: Date.now(),
      });
    } else {
      await this.agent.prompt(input);
    }
  }

  private renderMessages(): unknown {
    if (!this.agent) {
      return html`<div class="p-4 text-center text-muted-foreground">${i18n('No session available')}</div>`;
    }

    const state = this.agent.state;
    return html`
      <div class="flex flex-col gap-3">
        <message-list
          .messages=${this.agent.state.messages}
          .tools=${state.tools}
          .pendingToolCalls=${this.agent ? this.agent.state.pendingToolCalls : new Set<string>()}
          .isStreaming=${state.isStreaming}
        ></message-list>

        <streaming-message-container
          class="${state.isStreaming ? '' : 'hidden'}"
          .tools=${state.tools}
          .isStreaming=${state.isStreaming}
          .pendingToolCalls=${state.pendingToolCalls}
          .isStreaming=${state.isStreaming}
        ></streaming-message-container>
      </div>
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
