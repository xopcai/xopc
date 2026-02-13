import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { Paperclip, Send, Square, X, FileText, Image, File, Brain } from 'lucide';
import { i18n, t } from '../utils/i18n';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  content: string; // base64
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
  @property({ attribute: false }) currentModel?: { id: string; provider: string };
  @property({ attribute: false }) thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high';

  @property({ attribute: false }) onSend?: (input: string, attachments: Attachment[]) => void;
  @property({ attribute: false }) onAbort?: () => void;
  @property({ attribute: false }) onModelSelect?: () => void;
  @property({ attribute: false }) onThinkingChange?: (level: 'off' | 'minimal' | 'low' | 'medium' | 'high') => void;

  @state() private _isComposing = false;
  @state() private _isDragging = false;
  @state() private _processingFiles = false;
  @state() private _showAttachMenu = false;
  @state() private _isSending = false;

  private textareaRef = createRef<HTMLTextAreaElement>();
  private fileInputRef = createRef<HTMLInputElement>();
  private menuRef = createRef<HTMLDivElement>();

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

  private _handleOutsideClick = (e: MouseEvent) => {
    const menu = this.menuRef.value;
    const button = this.shadowRoot?.querySelector('.attach-menu-btn');
    if (menu && !menu.contains(e.target as Node) && button !== e.target) {
      this._showAttachMenu = false;
    }
  };

  override render(): unknown {
    return html`
      <div class="editor-container">
        ${this.attachments.length > 0 ? this._renderAttachments() : ''}
        
        <div class="input-row ${this._isDragging ? 'dragging' : ''}">
          ${this.showAttachmentButton ? this._renderAttachmentButton() : ''}
          
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

          <div class="input-actions">
            ${this.showThinkingSelector ? this._renderThinkingSelector() : ''}
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
              ${att.mimeType.startsWith('image/') ? html`
                <img src="${att.content}" alt="${att.name}" />
              ` : html`
                <FileText class="w-4 h-4" />
              `}
            </div>
            <span class="attachment-name">${att.name}</span>
            <button type="button" class="attachment-remove" @click=${() => this._removeAttachment(index)}>
              <X class="w-3 h-3" />
            </button>
          </div>
        `)}
      </div>
    `;
  }

  private _renderAttachmentButton(): unknown {
    return html`
      <div class="attach-wrapper">
        <button type="button" class="attach-btn" @click=${this._toggleAttachMenu} title=${i18n('Attach file')}>
          <Paperclip class="w-4 h-4" />
        </button>
        
        ${this._showAttachMenu ? html`
          <div ${ref(this.menuRef)} class="attach-menu">
            <button type="button" class="menu-item" @click=${() => this._triggerFileSelect('image')}>
              <Image class="w-4 h-4" />
              <span>Image</span>
            </button>
            <button type="button" class="menu-item" @click=${() => this._triggerFileSelect('document')}>
              <FileText class="w-4 h-4" />
              <span>Document</span>
            </button>
            <button type="button" class="menu-item" @click=${() => this._triggerFileSelect('all')}>
              <File class="w-4 h-4" />
              <span>All Files</span>
            </button>
          </div>
        ` : ''}
        
        <input
          ${ref(this.fileInputRef)}
          type="file"
          multiple
          accept=${this.acceptedTypes}
          class="hidden"
          @change=${this._handleFileInputChange}
        />
      </div>
    `;
  }

  private _renderThinkingSelector(): unknown {
    return html`
      <div class="thinking-wrapper">
        <div class="thinking-icon">
          <Brain class="w-3.5 h-3.5" />
        </div>
        <select
          class="thinking-select"
          .value=${this.thinkingLevel || 'off'}
          @change=${(e: Event) => {
            const target = e.target as HTMLSelectElement;
            this.onThinkingChange?.(target.value as any);
          }}
        >
          <option value="off">${t('chat.thinkingLevelNone')}</option>
          <option value="minimal">Lv.1</option>
          <option value="low">Lv.2</option>
          <option value="medium">Lv.3</option>
          <option value="high">Lv.4</option>
        </select>
      </div>
    `;
  }

  private _renderSendButton(): unknown {
    const canSend = this.value.trim() || this.attachments.length > 0;

    if (this.isStreaming) {
      return html`
        <button type="button" class="stop-btn" @click=${() => this.onAbort?.()} title=${i18n('Abort')}>
          <Square class="w-4 h-4" fill="currentColor" />
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
        <Send class="w-4 h-4" />
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

  private _toggleAttachMenu(): void {
    this._showAttachMenu = !this._showAttachMenu;
  }

  private _triggerFileSelect(type: 'image' | 'document' | 'all'): void {
    this._showAttachMenu = false;
    
    const input = this.fileInputRef.value;
    if (!input) return;
    
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
    
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  private _send(): void {
    if (this._isSending || this.isStreaming) return;
    if (!this.value.trim() && this.attachments.length === 0) return;
    
    this._isSending = true;
    const attachments = [...this.attachments];
    this.onSend?.(this.value, attachments);
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
    const base64 = await this._readFileAsBase64(file);
    const isImage = file.type.startsWith('image/');

    return {
      id: crypto.randomUUID(),
      name: file.name,
      type: isImage ? 'image' : 'document',
      mimeType: file.type,
      size: file.size,
      content: base64,
    };
  }

  private _readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  private _removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index);
  }

  private _formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}
