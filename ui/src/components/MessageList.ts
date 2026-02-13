import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('message-list')
export class MessageList extends LitElement {
  @property({ attribute: false }) messages: Array<any> = [];
  @property({ attribute: false }) tools: Map<string, any> = new Map();
  @property({ attribute: false }) pendingToolCalls: Set<string> = new Set();
  @property({ type: Boolean }) isStreaming = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    return html`
      <div class="flex flex-col gap-4">
        ${this.messages.map((message) => this.renderMessage(message))}
      </div>
    `;
  }

  private renderMessage(message: any): unknown {
    const isUser = message.role === 'user' || message.role === 'user-with-attachments';
    const isAssistant = message.role === 'assistant';
    const isTool = message.role === 'tool' || message.role === 'tool_result';

    return html`
      <div class="flex gap-3 ${isUser ? 'flex-row-reverse' : ''}">
        <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 
          isAssistant ? 'bg-green-500 text-white' : 
          'bg-purple-500 text-white'
        }">
          ${isUser ? '👤' : isAssistant ? '🤖' : '🔧'}
        </div>
        
        <div class="flex flex-col gap-1 max-w-[80%]">
          <div class="text-xs text-muted-foreground">
            ${isUser ? 'You' : isAssistant ? 'Assistant' : 'Tool'} · ${this._formatTime(message.timestamp)}
          </div>
          
          <div class="rounded-lg p-3 ${isUser ? 'bg-primary/10' : 'bg-muted'}">
            ${this.renderContent(message)}
          </div>
          
          ${isAssistant && message.usage ? this.renderUsage(message.usage) : ''}
        </div>
      </div>
    `;
  }

  private renderContent(message: any): unknown {
    const content = message.content || [];
    
    return html`
      <div class="prose prose-sm dark:prose-invert">
        ${content.map((block: any) => {
          if (block.type === 'text') {
            return html`<p class="whitespace-pre-wrap">${this._escapeHtml(block.text || '')}</p>`;
          }
          if (block.type === 'image') {
            return html`<img src="${block.source?.data}" alt="User image" class="max-w-full rounded" />`;
          }
          if (block.type === 'tool_use') {
            return this.renderToolUse(block);
          }
          if (block.type === 'tool_result') {
            return this.renderToolResult(block);
          }
          return '';
        })}
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

  private renderToolResult(block: any): unknown {
    const result = block.content || block.result;
    const isError = block.is_error || block.error;
    
    if (result == null) {
      return html`<div class="text-muted-foreground italic">No result</div>`;
    }
    
    return html`
      <div class="rounded border ${isError ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'} p-2 text-sm">
        <pre class="text-xs overflow-x-auto ${isError ? 'text-red-600' : ''}">${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
      </div>
    `;
  }

  private renderUsage(usage: any): unknown {
    const parts: string[] = [];
    if (usage.input) parts.push(`In: ${usage.input}`);
    if (usage.output) parts.push(`Out: ${usage.output}`);
    if (usage.cacheRead) parts.push(`Cache: ${usage.cacheRead}`);
    if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
    
    if (parts.length > 0) {
      return html`<div class="text-xs text-muted-foreground">${parts.join(' · ')}</div>`;
    }
    return '';
  }

  private _formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString();
  }

  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
