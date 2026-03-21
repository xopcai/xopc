import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Paperclip, Send, Square, X, FileText, Mic } from 'lucide';
import { loadAttachment, formatFileSize, type Attachment } from '../utils/attachment-utils';
import { iconToSvg } from '../utils/lucide-icon.js';
import { i18n } from '../utils/i18n';

// Thinking level type
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

@customElement('message-editor')
export class MessageEditor extends LitElement {
  @query('textarea') private textarea!: HTMLTextAreaElement;

  @property({ type: String }) value = '';
  @property({ type: Array }) attachments: Attachment[] = [];
  @property({ type: Boolean }) isStreaming = false;
  @property({ type: Boolean }) showAttachmentButton = true;
  @property({ type: Boolean }) showModelSelector = true;
  @property({ type: Boolean }) showThinkingSelector = true;
  @property({ type: String }) thinkingLevel: ThinkingLevel = 'medium';
  
  @property({ attribute: false }) onSend?: (input: string, attachments: Attachment[], thinkingLevel?: ThinkingLevel) => void;
  @property({ attribute: false }) onAbort?: () => void;
  @property({ attribute: false }) onModelSelect?: () => void;
  @property({ attribute: false }) onThinkingChange?: (level: ThinkingLevel) => void;

  @state() private _isComposing = false;
  @state() private _isDragging = false;
  @state() private _processingFiles = false;
  @state() private _isSending = false;

  private textareaRef = createRef<HTMLTextAreaElement>();
  private fileInputRef = createRef<HTMLInputElement>();
  private readonly maxFileSize = 20 * 1024 * 1024; // 20MB
  private readonly acceptedTypes = 'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('dragover', this._handleDocumentDragOver);
    document.addEventListener('drop', this._handleDocumentDrop);
    document.addEventListener('dragleave', this._handleDocumentDragLeave);
    document.addEventListener('click', this._handleOutsideClick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('dragover', this._handleDocumentDragOver);
    document.removeEventListener('drop', this._handleDocumentDrop);
    document.removeEventListener('dragleave', this._handleDocumentDragLeave);
    document.removeEventListener('click', this._handleOutsideClick);
  }

  private _handleDocumentDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      this._isDragging = true;
    }
  };

  private _handleDocumentDragLeave = (e: DragEvent) => {
    if (e.relatedTarget === null) {
      this._isDragging = false;
    }
  };

  private _handleDocumentDrop = async (e: DragEvent) => {
    e.preventDefault();
    this._isDragging = false;
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await this._processFiles(Array.from(files));
    }
  };

  private _handleOutsideClick = (_e: MouseEvent): void => {
    // Handle click outside if needed
  };

  override render(): unknown {
    return html`
      <div class="editor-container">
        ${this.attachments.length > 0 ? this._renderAttachments() : ''}
        
        <div class="input-row ${this._isDragging ? 'dragging' : ''}">
          <textarea
            ${ref(this.textareaRef)}
            class="text-input"
            placeholder=${i18n('Type a message...')}
            .value=${this.value}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
            @compositionstart=${() => this._isComposing = true}
            @compositionend=${() => this._isComposing = false}
            @paste=${this._handlePaste}
            rows="1"
          ></textarea>
        </div>

        <div class="toolbar-row">
          ${this.showAttachmentButton ? this._renderAttachmentButton() : ''}
          ${this._renderVoiceButton()}
          ${this._renderThinkingSelector()}
          <div class="toolbar-spacer"></div>
          ${this._renderSendButton()}
        </div>

        ${this._isDragging ? this._renderDropOverlay() : ''}
      </div>
    `;
  }

  private _renderAttachments(): unknown {
    return html`
      <div class="attachments-row">
        ${this.attachments.map((att, index) => html`
          <div class="attachment-chip">
            <div class="attachment-preview">
              ${att.mimeType.startsWith('image/') ? html`
                <img src="${att.content}" alt="${att.name}" />
              ` : html`
                ${unsafeHTML(iconToSvg(FileText, 'w-4 h-4'))}
              `}
            </div>
            <span class="attachment-name">${att.name}</span>
            <button type="button" class="attachment-remove" @click=${() => this._removeAttachment(index)}>
              ${unsafeHTML(iconToSvg(X, 'w-3 h-3'))}
            </button>
          </div>
        `)}
      </div>
    `;
  }

  private _renderAttachmentButton(): unknown {
    return html`
      <button type="button" class="attach-btn" @click=${() => this._triggerFileSelect('all')} title=${i18n('Attach file')}>
        ${unsafeHTML(iconToSvg(Paperclip, 'w-4 h-4'))}
      </button>
      
      <input
        ${ref(this.fileInputRef)}
        type="file"
          multiple
          accept=${this.acceptedTypes}
          class="hidden"
          @change=${this._handleFileInputChange}
        />
    `;
  }

  private _renderVoiceButton(): unknown {
    return html`
      <button type="button" class="toolbar-btn voice-btn" title=${i18n('Voice input') + ' (coming soon)'}>
        ${unsafeHTML(iconToSvg(Mic, 'w-4 h-4'))}
      </button>
    `;
  }

  private _renderThinkingSelector(): unknown {
    // Show thinking selector if enabled
    if (!this.showThinkingSelector) {
      return null;
    }

    const levelLabels: Record<ThinkingLevel, string> = {
      off: '💭',
      minimal: '🧠',
      low: '💡',
      medium: '🧠',
      high: '🧠',
      xhigh: '🧠',
      adaptive: '✨',
    };

    return html`
      <div class="thinking-pill" title=${i18n('Thinking level') + ': ' + this.thinkingLevel}>
        <span class="thinking-icon">${levelLabels[this.thinkingLevel] || '🧠'}</span>
        <select 
          class="thinking-select-hidden"
          .value=${this.thinkingLevel}
          @change=${(e: Event) => {
            const level = (e.target as HTMLSelectElement).value as ThinkingLevel;
            this.thinkingLevel = level;
            this.onThinkingChange?.(level);
          }}
        >
          <option value="off">${i18n('Off')}</option>
          <option value="minimal">${i18n('Minimal')}</option>
          <option value="low">${i18n('Low')}</option>
          <option value="medium">${i18n('Medium')}</option>
          <option value="high">${i18n('High')}</option>
          <option value="xhigh">${i18n('X-High')}</option>
          <option value="adaptive">${i18n('Adaptive')}</option>
        </select>
      </div>
    `;
  }

  private _renderSendButton(): unknown {
    const canSend = this.value.trim() || this.attachments.length > 0;

    if (this.isStreaming) {
      return html`
        <button type="button" class="stop-btn" @click=${() => this.onAbort?.()} title=${i18n('Abort')}>
          ${unsafeHTML(iconToSvg(Square, 'w-4 h-4'))}
        </button>
      `;
    }

    return html`
      <button
        type="button"
        class="send-btn ${canSend ? 'active' : ''}"
        ?disabled=${!canSend}
        @click=${this._send}
        title=${i18n('Send message')}
      >
        ${unsafeHTML(iconToSvg(Send, 'w-4 h-4'))}
      </button>
    `;
  }

  private _renderDropOverlay(): unknown {
    return html`
      <div class="drop-overlay">
        <span>Drop files here to attach</span>
      </div>
    `;
  }

  private _triggerFileSelect(type: 'image' | 'document' | 'all'): void {
    // Try ref first
    let input: HTMLInputElement | null = this.fileInputRef.value ?? null;

    // Fallback: query selector since we're using light DOM
    if (!input) {
      const fallback = this.querySelector('input[type="file"]');
      if (fallback instanceof HTMLInputElement) {
        input = fallback;
      }
    }

    if (!input) {
      console.warn('File input not found');
      return;
    }

    if (type === 'image') {
      input.accept = 'image/*';
    } else if (type === 'document') {
      input.accept = '.pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml,.zip';
    } else {
      input.accept = this.acceptedTypes;
    }

    input.click();
  }

  private _handleInput = (e: Event): void => {
    const target = e.target as HTMLTextAreaElement;
    this.value = target.value;
    this._adjustTextareaHeight();
  };

  private _handleKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey && !this._isComposing) {
      e.preventDefault();
      this._send();
    }
  };

  private _handlePaste = async (e: ClipboardEvent): Promise<void> => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await this._processFiles(imageFiles);
    }
  };

  private _adjustTextareaHeight(): void {
    const textarea = this.textareaRef.value;
    if (!textarea) return;
    
    const lineHeight = 24; // ~1.5rem line-height
    const maxLines = 8;
    const maxHeight = lineHeight * maxLines;
    
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
  }

  private _send(): void {
    if (this._isSending || this.isStreaming) return;
    if (!this.value.trim() && this.attachments.length === 0) return;
    
    this._isSending = true;
    const attachments = [...this.attachments];
    const thinkingLevel = this.thinkingLevel;
    this.onSend?.(this.value, attachments, thinkingLevel);
    this.value = '';
    this.attachments = [];
    
    requestAnimationFrame(() => {
      this._adjustTextareaHeight();
      setTimeout(() => {
        this._isSending = false;
      }, 500);
    });
  }

  private _handleFileInputChange = async (e: Event): Promise<void> => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    await this._processFiles(Array.from(files));
    input.value = '';
  };

  private async _processFiles(files: File[]): Promise<void> {
    this._processingFiles = true;

    try {
      for (const file of files) {
        if (file.size > this.maxFileSize) {
          console.warn(`File ${file.name} exceeds max size of ${this.maxFileSize} bytes`);
          continue;
        }

        const attachment = await this._loadAttachment(file);
        this.attachments = [...this.attachments, attachment];
      }
    } finally {
      this._processingFiles = false;
    }
  }

  private async _loadAttachment(file: File): Promise<Attachment> {
    // Use the enhanced loadAttachment from attachment-utils
    const attachment = await loadAttachment(file, file.name);
    return attachment;
  }

  private _removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index);
  }

  private _formatFileSize(bytes: number): string {
    return formatFileSize(bytes);
  }
}
