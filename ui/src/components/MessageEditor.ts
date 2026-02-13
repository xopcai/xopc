import { html, LitElement, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { Paperclip, Send, Square, X, Brain, Loader2 } from 'lucide';
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

  private textareaRef = createRef<HTMLTextAreaElement>();
  private fileInputRef = createRef<HTMLInputElement>();

  private readonly maxFileSize = 20 * 1024 * 1024; // 20MB
  private readonly acceptedTypes = 'image/*,application/pdf,.docx,.pptx,.xlsx,.xls,.txt,.md,.json,.xml,.html,.css,.js,.ts,.jsx,.tsx,.yml,.yaml';

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Global drag & drop handlers
    document.addEventListener('dragover', this._handleDocumentDragOver);
    document.addEventListener('drop', this._handleDocumentDrop);
    document.addEventListener('dragleave', this._handleDocumentDragLeave);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('dragover', this._handleDocumentDragOver);
    document.removeEventListener('drop', this._handleDocumentDrop);
    document.removeEventListener('dragleave', this._handleDocumentDragLeave);
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

  override render(): unknown {
    return html`
      <div class="flex flex-col gap-2">
        ${this.attachments.length > 0 ? this._renderAttachments() : ''}
        
        <div class="flex items-end gap-2 p-3 border rounded-lg bg-card ${this._isDragging ? 'border-primary bg-primary/5' : ''}">
          ${this.showAttachmentButton ? this._renderAttachmentButton() : ''}
          
          <div class="flex-1 relative">
            <textarea
              ${ref(this.textareaRef)}
              class="w-full min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent focus:outline-none focus:ring-0 py-2"
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
      <div class="flex flex-wrap gap-2 px-3 pt-2">
        ${this.attachments.map((att, index) => html`
          <div class="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm">
            ${att.mimeType.startsWith('image/') ? html`
              <img src="${att.content}" alt="${att.name}" class="w-4 h-4 object-cover rounded" />
            ` : html`
              <Paperclip class="w-4 h-4" />
            `}
            <span class="max-w-[100px] truncate">${att.name}</span>
            <button
              type="button"
              class="p-0.5 hover:bg-destructive/20 rounded"
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
      <button
        type="button"
        class="p-2 rounded hover:bg-accent"
        @click=${this._triggerFileSelect}
        title=${i18n('Attach file')}
      >
        <Paperclip class="w-5 h-5" />
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

  private _renderThinkingSelector(): unknown {
    const options: Array<{ value: 'off' | 'minimal' | 'low' | 'medium' | 'high'; label: string; icon: TemplateResult }> = [
      { value: 'off', label: '🚫', icon: html`` },
      { value: 'minimal', label: '1', icon: html`<Brain class="w-3 h-3" />` },
      { value: 'low', label: '2', icon: html`<Brain class="w-3 h-3" />` },
      { value: 'medium', label: '3', icon: html`<Brain class="w-3 h-3" />` },
      { value: 'high', label: '4', icon: html`<Brain class="w-3 h-3" />` },
    ];

    return html`
      <select
        class="text-xs bg-transparent border rounded px-1 py-1"
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
          class="p-2 rounded bg-red-500 text-white hover:bg-red-600"
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
        class="p-2 rounded ${canSend ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground'}"
        ?disabled=${!canSend}
        @click=${this._send}
        title=${i18n('Send message')}
      >
        <Send class="w-5 h-5" />
      </button>
    `;
  }

  private _renderDropOverlay(): unknown {
    return html`
      <div class="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none">
        <span class="text-primary font-medium">Drop files here</span>
      </div>
    `;
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
    if (!this.value.trim() && this.attachments.length === 0) return;
    const attachments = [...this.attachments];
    this.onSend?.(this.value, attachments);
    this.value = '';
    this.attachments = [];
    
    // Reset textarea height
    requestAnimationFrame(() => {
      this._adjustTextareaHeight();
    });
  }

  private _triggerFileSelect(): void {
    this.fileInputRef.value?.click();
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
}
