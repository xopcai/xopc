import { html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ArtifactElement } from './ArtifactElement.js';
import { i18n } from '../../utils/i18n.js';

@customElement('image-artifact')
export class ImageArtifact extends ArtifactElement {
  @property({ type: String }) private _content = '';

  get content(): string {
    return this._content;
  }

  set content(value: string) {
    this._content = value;
    this.requestUpdate();
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = 'block';
    this.style.height = '100%';
  }

  private getMimeType(): string {
    const ext = this.filename.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'bmp') return 'image/bmp';
    if (ext === 'ico') return 'image/x-icon';
    return 'image/png';
  }

  private getImageUrl(): string {
    if (this._content.startsWith('data:')) {
      return this._content;
    }
    return `data:${this.getMimeType()};base64,${this._content}`;
  }

  private decodeBase64(): Uint8Array {
    let base64Data: string;

    if (this._content.startsWith('data:')) {
      const base64Match = this._content.match(/base64,(.+)/);
      if (base64Match) {
        base64Data = base64Match[1];
      } else {
        return new Uint8Array(0);
      }
    } else {
      base64Data = this._content;
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  }

  public getHeaderButtons(): TemplateResult {
    return html`
      <div class="flex items-center gap-1">
        <button
          class="p-2 hover:bg-muted rounded-md transition-colors"
          @click=${this._download}
          title="${i18n('Download')}"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </button>
      </div>
    `;
  }

  private _download = () => {
    const bytes = this.decodeBase64();
    const arrayBuffer = bytes.buffer.slice(0) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: this.getMimeType() });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  override render(): TemplateResult {
    return html`
      <div class="h-full flex flex-col bg-background overflow-auto">
        <div class="flex-1 flex items-center justify-center p-4">
          <img
            src="${this.getImageUrl()}"
            alt="${this.filename}"
            class="max-w-full max-h-full object-contain"
            @error=${(e: Event) => {
              const target = e.target as HTMLImageElement;
              target.src =
                "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext x='50' y='50' text-anchor='middle' dominant-baseline='middle' fill='%23999'%3EImage Error%3C/text%3E%3C/svg%3E";
            }}
          />
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'image-artifact': ImageArtifact;
  }
}
