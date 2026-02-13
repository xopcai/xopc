import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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
      <div class="flex gap-3">
        <div class="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0">
          🤖
        </div>
        
        <div class="flex flex-col gap-1 max-w-[80%]">
          <div class="text-xs text-muted-foreground">Assistant · streaming...</div>
          
          <div class="rounded-lg p-3 bg-muted">
            ${this.renderStreamingContent()}
          </div>
        </div>
      </div>
    `;
  }

  private renderStreamingContent(): unknown {
    const content = this._currentMessage?.content || [];
    
    return html`
      <div class="prose prose-sm dark:prose-invert">
        ${content.map((block: any) => {
          if (block.type === 'text') {
            return html`<p class="whitespace-pre-wrap">${this._escapeHtml(block.text || '')}</p>`;
          }
          if (block.type === 'tool_use') {
            return this.renderToolUse(block);
          }
          return '';
        })}
        ${this.isStreaming ? html`<span class="animate-pulse">▌</span>` : ''}
      </div>
    `;
  }

  private renderToolUse(block: any): unknown {
    const name = block.name || block.function?.name;
    const input = block.input || block.function?.arguments || {};
    
    return html`
      <div class="rounded border bg-yellow-50 dark:bg-yellow-900/20 p-2 text-sm">
        <div class="font-semibold flex items-center gap-1">
          <span>🔧</span>
          <span>${name}</span>
        </div>
        <pre class="mt-1 text-xs overflow-x-auto">${JSON.stringify(input, null, 2)}</pre>
      </div>
    `;
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
