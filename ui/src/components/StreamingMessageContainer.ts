import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface MessageContent {
  type: string;
  text?: string;
  name?: string;
  input?: any;
  function?: { name?: string; arguments?: any };
}

@customElement('streaming-message-container')
export class StreamingMessageContainer extends LitElement {
  @property({ attribute: false }) tools: Map<string, any> = new Map();
  @property({ attribute: false }) pendingToolCalls: Set<string> = new Set();
  @property({ type: Boolean }) isStreaming = false;

  @state() private _currentMessage: any = null;
  @state() private _isComplete = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  public setMessage(message: any, isComplete: boolean): void {
    this._currentMessage = message;
    this._isComplete = isComplete;
  }

  override render(): unknown {
    if (!this._currentMessage) return null;

    return html`
      <div class="flex gap-3 message-item">
        <div class="avatar assistant">
          AI
        </div>
        
        <div class="flex flex-col gap-1 max-w-[85%]">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span class="font-medium">Assistant</span>
            <span>·</span>
            <span class="text-accent animate-pulse">thinking...</span>
          </div>
          
          <div class="rounded-xl p-3 bg-secondary">
            ${this.renderStreamingContent()}
          </div>
        </div>
      </div>
    `;
  }

  private renderStreamingContent(): unknown {
    const content = this._currentMessage?.content || [];
    
    return html`
      <div class="markdown-content">
        ${content.map((block: MessageContent) => {
          if (block.type === 'text') {
            return html`<p class="whitespace-pre-wrap">${this._escapeHtml(block.text || '')}<span class="streaming-cursor"></span></p>`;
          }
          if (block.type === 'tool_use') {
            return this.renderToolUse(block);
          }
          return '';
        })}
        ${this.isStreaming && (!content.length || content[content.length - 1]?.type !== 'text') ? html`<span class="streaming-cursor"></span>` : ''}
      </div>
    `;
  }

  private renderToolUse(block: MessageContent): unknown {
    const name = block.name || block.function?.name;
    const input = block.input || block.function?.arguments || {};
    
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    
    return html`
      <div class="tool-call">
        <div class="name">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
          <span>${name}</span>
        </div>
        <pre class="input">${inputStr}</pre>
      </div>
    `;
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
