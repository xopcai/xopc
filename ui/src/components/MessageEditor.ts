import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { Paperclip, Send, Square, X, Brain, Loader2, FileText, Image, File } from 'lucide';
import { i18n } from '../utils/i18n.js';

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
    // Global drag & drop handlers
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
      <div class="flex flex-col gap-3">
        ${this.attachments.length > 0 ? this._renderAttachments() : ''}
        
        <div class="flex items-end gap-2 p-3 border rounded-xl bg-secondary ${this._isDragging ? 'border-accent bg-accent-light' : ''} transition-all">
          ${this.showAttachmentButton ? this._renderAttachmentButton() : ''}
          
          <div class="flex-1 relative">
            <textarea
              ${ref(this.textareaRef)}
              class="w-full min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent focus:outline-none focus:ring-0 py-2 text-base"
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

          <div class="flex items-center gap-1">
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
      <div class="attachment-grid" style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));">
        ${this.attachments.map((att, index) => html`
          <div class="attachment-item">
            <div class="preview">
              ${att.mimeType.startsWith('image/') ? html`
                <img src="${att.content}" alt="${att.name}" />
              ` : html`
                <div class="flex flex-col items-center justify-center h-full text-muted">
                  ${this._getFileIcon(att.mimeType)}
                  <span class="text-xs mt-1">${this._getFileExtension(att.name)}</span>
                </div>
              `}
            </div>
            <div class="name">${att.name}</div>
            <div class="size">${this._formatFileSize(att.size)}</div>
            <button
              type="button"
              class="remove-btn"
              @click=${() => this._removeAttachment(index)}
            >
              <X class="w-3 h-3" />
            </button>
          </div>
        `)}
      </div>
    `;
  }

  private _renderAttachmentButton(): unknown {
    return html`
      <div class="relative">
        <button
          type="button"
          class="icon-btn attach-menu-btn"
          @click=${this._toggleAttachMenu}
          title=${i18n('Attach file')}
        >
          <Paperclip class="w-5 h-5" />
        </button>
        
        ${this._showAttachMenu ? html`
          <div 
            ${ref(this.menuRef)}
            class="absolute bottom-full left-0 mb-2 w-48 bg-primary border border-border rounded-lg shadow-lg py-1 animate-slide-up z-50"
          >
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm hover:bg-hover flex items-center gap-2"
              @click=${() => this._triggerFileSelect('image')}
            >
              <Image class="w-4 h-4" />
              <span>Image</span>
            </button>
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm hover:bg-hover flex items-center gap-2"
              @click=${() => this._triggerFileSelect('document')}
            >
              <FileText class="w-4 h-4" />
              <span>Document</span>
            </button>
            <button
              type="button"
              class="w-full px-3 py-2 text-left text-sm hover:bg-hover flex items-center gap-2"
              @click=${() => this._triggerFileSelect('all')}
            >
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
    const options: Array<{ value: 'off' | 'minimal' | 'low' | 'medium' | 'high'; label: string }> = [
      { value: 'off', label: '🚫' },
      { value: 'minimal', label: '1' },
      { value: 'low', label: '2' },
      { value: 'medium', label: '3' },
      { value: 'high', label: '4' },
    ];

    return html`
      <select
        class="text-xs bg-tertiary border-0 rounded-md px-2 py-1.5 cursor-pointer hover:bg-hover transition-colors"
        .value=${this.thinkingLevel || 'off'}
        @change=${(e: Event) => {
          const target = e.target as HTMLSelectElement;
          this.onThinkingChange?.(target.value as any);
        }}
      >
        ${options.map(opt => html`
          <option value=${opt.value}>${opt.label}</option>
        `)}
      </select>
    `;
  }

  private _renderSendButton(): unknown {
    const canSend = this.value.trim() || this.attachments.length > 0;

    if (this.isStreaming) {
      return html`
        <button
          type="button"
          class="icon-btn bg-red-500 text-white hover:bg-red-600"
          @click=${() => this.onAbort?.()}
          title=${i18n('Abort')}
        >
          <Square class="w-5 h-5" fill="currentColor" />
        </button>
      `;
    }

    return html`
      <button
        type="button"
        class="btn-primary ${canSend ? '' : 'opacity-50 cursor-not-allowed'}"
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
        <span class="text">Drop files here to attach</span>
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
    // Prevent double-sending or sending while streaming
    if (this._isSending || this.isStreaming) return;
    if (!this.value.trim() && this.attachments.length === 0) return;
    
    this._isSending = true;
    const attachments = [...this.attachments];
    this.onSend?.(this.value, attachments);
    this.value = '';
    this.attachments = [];
    
    // Reset textarea height
    requestAnimationFrame(() => {
      this._adjustTextareaHeight();
      // Delay reset of sending flag to prevent rapid clicks
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
    
    // Reset input to allow selecting same file again
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
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private _removeAttachment(index: number): void {
    this.attachments = this.attachments.filter((_, i) => i !== index);
  }

  private _getFileIcon(mimeType: string): unknown {
    if (mimeType.startsWith('image/')) {
      return html`<Image class="w-8 h-8" />`;
    }
    if (mimeType.includes('pdf')) {
      return html`
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    if (mimeType.includes('word') || mimeType.includes('document')) {
      return html`
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    if (mimeType.includes('sheet') || mimeType.includes('excel')) {
      return html`
        <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
      `;
    }
    return html`<FileText class="w-8 h-8" />`;
  }

  private _getFileExtension(filename: string): string {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()?.toUpperCase() || '' : '';
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
