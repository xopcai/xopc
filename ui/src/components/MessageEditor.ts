import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { i18n } from '../utils/i18n.js';
import type { Attachment } from '../utils/attachment-utils.js';

@customElement('message-editor')
export class MessageEditor extends LitElement {
  @property({ type: String }) value = '';
  @property({ type: Array }) attachments: Attachment[] = [];
  @property({ type: Boolean }) isStreaming = false;
  @property({ type: Boolean }) showAttachmentButton = true;
  @property({ type: Boolean }) showModelSelector = true;
  @property({ type: Boolean }) showThinkingSelector = true;
  @property({ attribute: false }) currentModel?: { id: string; provider: string };
  @property({ attribute: false }) thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';

  @property({ attribute: false }) onSend?: (input: string, attachments: Attachment[]) => void;
  @property({ attribute: false }) onAbort?: () => void;
  @property({ attribute: false }) onModelSelect?: () => void;
  @property({ attribute: false }) onThinkingChange?: (level: 'off' | 'minimal' | 'low' | 'medium' | 'high') => void;

  @state() private _isComposing = false;

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    return html`
      <div class="flex items-end gap-2 p-3 border rounded-lg bg-card">
        ${this.showAttachmentButton ? this.renderAttachmentButton() : ''}
        
        <textarea
          class="flex-1 min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent focus:outline-none focus:ring-0"
          placeholder=${i18n('Type a message...')}
          .value=${this.value}
          @input=${(e: Event) => this._handleInput(e)}
          @keydown=${(e: KeyboardEvent) => this._handleKeydown(e)}
          @compositionstart=${() => this._isComposing = true}
          @compositionend=${() => this._isComposing = false}
          rows="1"
        ></textarea>

        <div class="flex items-center gap-1">
          ${this.showThinkingSelector ? this.renderThinkingSelector() : ''}
          ${this.renderSendButton()}
        </div>
      </div>
    `;
  }

  private renderAttachmentButton(): unknown {
    return html`
      <button
        type="button"
        class="p-2 rounded hover:bg-accent"
        @click=${() => this._triggerFileSelect()}
        title=${i18n('Attach file')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>
    `;
  }

  private renderThinkingSelector(): unknown {
    const labels: Record<string, string> = {
      off: '🚫',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    };

    return html`
      <select
        class="text-xs bg-transparent border rounded px-1 py-1"
        .value=${this.thinkingLevel || 'off'}
        @change=${(e: Event) => {
          const target = e.target as HTMLSelectElement;
          this.onThinkingChange?.(target.value as any);
        }}
      >
        ${Object.entries(labels).map(([value, label]) => html`
          <option value=${value}>${label}</option>
        `)}
      </select>
    `;
  }

  private renderSendButton(): unknown {
    const canSend = this.value.trim() || this.attachments.length > 0;

    if (this.isStreaming) {
      return html`
        <button
          type="button"
          class="p-2 rounded bg-red-500 text-white hover:bg-red-600"
          @click=${() => this.onAbort?.()}
          title=${i18n('Abort')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        </button>
      `;
    }

    return html`
      <button
        type="button"
        class="p-2 rounded ${canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground'}"
        ?disabled=${!canSend}
        @click=${() => this._send()}
        title=${i18n('Send message')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
      </button>
    `;
  }

  private _handleInput(e: Event): void {
    const target = e.target as HTMLTextAreaElement;
    this.value = target.value;
  }

  private _handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !this._isComposing) {
      e.preventDefault();
      this._send();
    }
  }

  private _send(): void {
    if (!this.value.trim() && this.attachments.length === 0) return;
    this.onSend?.(this.value, this.attachments);
  }

  private _triggerFileSelect(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.txt,.md,.json,.js,.ts,.py';
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;

      for (const file of Array.from(files)) {
        const content = await this._readFile(file);
        this.attachments = [...this.attachments, {
          name: file.name,
          type: file.type,
          content,
        }];
      }
    };
    input.click();
  }

  private _readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
