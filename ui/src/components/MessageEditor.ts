import { html, LitElement } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Ban, File, Mic, Send, Sparkles, Square, X, FileText } from 'lucide';
import { loadAttachment, formatFileSize, type Attachment, MAX_CHAT_ATTACHMENTS } from '../utils/attachment-utils';
import { iconToSvg } from '../utils/lucide-icon.js';
import { i18n, t } from '../utils/i18n';
import './ModelSelector.js';

// Thinking level type
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'adaptive';

/** Thinking pill: Sparkles for brand consistency; Ban when off */
function thinkingLevelIcon(level: ThinkingLevel): typeof Sparkles {
  return level === 'off' ? Ban : Sparkles;
}

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
  /** Effective model ref (e.g. provider/model-id) for this chat session */
  @property({ type: String }) currentModel = '';
  @property({ type: String }) gatewayToken?: string;

  @property({ attribute: false }) onSend?: (input: string, attachments: Attachment[], thinkingLevel?: ThinkingLevel) => void;
  @property({ attribute: false }) onAbort?: () => void;
  /** Called when the user picks another model from the chat toolbar */
  @property({ attribute: false }) onModelChange?: (modelId: string) => void;
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
      <div class="editor-container editor-card ${this._isDragging ? 'dragging' : ''}">
        ${this.attachments.length > 0 ? this._renderAttachments() : ''}

        <div class="editor-input-area">
          <textarea
            ${ref(this.textareaRef)}
            class="text-input"
            placeholder=${i18n('chat.inputPlaceholder')}
            .value=${this.value}
            @input=${this._handleInput}
            @keydown=${this._handleKeydown}
            @compositionstart=${() => this._isComposing = true}
            @compositionend=${() => this._isComposing = false}
            @paste=${this._handlePaste}
            rows="1"
          ></textarea>
        </div>

        <div
          class="toolbar-row ${!this.showModelSelector ? 'toolbar-row--no-model' : ''} ${!this.showThinkingSelector ? 'toolbar-row--no-thinking' : ''}"
        >
          <div class="toolbar-slot toolbar-slot-thinking">${this._renderThinkingSelector()}</div>
          <div class="toolbar-slot toolbar-slot-model">
            ${this.showModelSelector ? this._renderModelSelector() : ''}
          </div>
          <div class="toolbar-slot toolbar-slot-actions">
            ${this.showAttachmentButton ? this._renderAttachmentButton() : ''}
            ${this._renderVoiceButton()}
            ${this._renderSendButton()}
          </div>
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
              ${att.mimeType?.startsWith('image/') ? html`
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
    const atLimit = this.attachments.length >= MAX_CHAT_ATTACHMENTS;
    const attachTitle = atLimit
      ? t('chat.maxAttachmentsReached', { max: MAX_CHAT_ATTACHMENTS })
      : `${i18n('Attach file')} (${this.attachments.length}/${MAX_CHAT_ATTACHMENTS})`;
    return html`
      <button
        type="button"
        class="toolbar-icon-btn"
        ?disabled=${atLimit}
        @click=${() => this._triggerFileSelect('all')}
        title=${attachTitle}
      >
        ${unsafeHTML(iconToSvg(File, 'w-4 h-4'))}
      </button>

      <input
        ${ref(this.fileInputRef)}
        type="file"
        multiple
        accept=${this.acceptedTypes}
        class="hidden file-input-hidden"
        @change=${this._handleFileInputChange}
      />
    `;
  }

  private _renderVoiceButton(): unknown {
    return html`
      <button
        type="button"
        class="toolbar-icon-btn voice-btn voice-btn-emphasis"
        title=${i18n('Voice input') + ' (coming soon)'}
        disabled
      >
        ${unsafeHTML(iconToSvg(Mic, 'w-4 h-4'))}
      </button>
    `;
  }

  private _renderModelSelector(): unknown {
    return html`
      <div class="chat-model-picker" title=${i18n('chat.currentModel')}>
        <model-selector
          .compact=${true}
          .value=${this.currentModel || ''}
          .label=${''}
          .placeholder=${i18n('chat.modelPlaceholder')}
          .filter=${'configured'}
          .token=${this.gatewayToken}
          .disabled=${this.isStreaming}
          @change=${(e: CustomEvent<{ modelId: string }>) => {
            const id = e.detail?.modelId;
            if (id && id !== this.currentModel) {
              this.onModelChange?.(id);
            }
          }}
        ></model-selector>
      </div>
    `;
  }

  private _renderThinkingSelector(): unknown {
    // Show thinking selector if enabled
    if (!this.showThinkingSelector) {
      return null;
    }

    const Icon = thinkingLevelIcon(this.thinkingLevel);

    return html`
      <div class="thinking-pill" title=${i18n('Thinking level') + ': ' + this.thinkingLevel}>
        <span class="thinking-icon" aria-hidden="true"
          >${unsafeHTML(iconToSvg(Icon, 'w-3.5 h-3.5 thinking-level-svg'))}</span
        >
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
        <button
          type="button"
          class="toolbar-icon-btn stop-btn"
          @click=${() => this.onAbort?.()}
          title=${i18n('Abort')}
        >
          ${unsafeHTML(iconToSvg(Square, 'w-4 h-4'))}
        </button>
      `;
    }

    return html`
      <button
        type="button"
        class="toolbar-icon-btn send-btn ${canSend ? 'active' : ''}"
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
    if (this.attachments.length >= MAX_CHAT_ATTACHMENTS) {
      console.warn(t('chat.maxAttachmentsReached', { max: MAX_CHAT_ATTACHMENTS }));
      return;
    }

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
    if (files.length === 0) return;

    const max = MAX_CHAT_ATTACHMENTS;
    const remaining = max - this.attachments.length;
    if (remaining <= 0) {
      console.warn(t('chat.maxAttachmentsReached', { max }));
      return;
    }

    const slice = files.slice(0, remaining);
    if (files.length > slice.length) {
      console.warn(
        t('chat.maxAttachmentsTruncated', { max, dropped: files.length - slice.length }),
      );
    }

    this._processingFiles = true;

    try {
      for (const file of slice) {
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
