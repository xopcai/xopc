import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { FileSpreadsheet, FileText, X } from 'lucide';
import type { Attachment } from '../utils/attachment-utils';
import { i18n } from '../utils/i18n';

// Convert lucide icon array format to SVG string
function iconToSvg(iconData: unknown, className = ''): string {
  if (!iconData || !Array.isArray(iconData)) return '';

  const [_tag, attrs, children] = iconData as [string, Record<string, string>, unknown[]];

  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const childrenStr = Array.isArray(children)
    ? children.map(child => {
        if (Array.isArray(child)) {
          const [cTag, cAttrs] = child;
          const cAttrStr = Object.entries(cAttrs || {})
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
          return `<${cTag} ${cAttrStr} />`;
        }
        return '';
      }).join('')
    : '';

  const finalAttrs = className ? `${attrStr} class="${className}"` : attrStr;

  return `<svg ${finalAttrs}>${childrenStr}</svg>`;
}

@customElement('attachment-tile')
export class AttachmentTile extends LitElement {
  @property({ type: Object }) attachment!: Attachment;
  @property({ type: Boolean }) showDelete = false;
  @property() onDelete?: () => void;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.style.display = 'block';
    this.classList.add('max-h-16');
  }

  private handleClick = () => {
    // Dispatch event for parent to handle
    this.dispatchEvent(new CustomEvent('attachment-click', {
      detail: this.attachment,
      bubbles: true,
      composed: true
    }));
  };

  override render(): TemplateResult {
    const hasPreview = !!this.attachment.preview;
    const isImage = this.attachment.type === 'image';
    const isPdf = this.attachment.mimeType === 'application/pdf';
    const isExcel =
      this.attachment.mimeType?.includes('spreadsheetml') ||
      this.attachment.name.toLowerCase().endsWith('.xlsx') ||
      this.attachment.name.toLowerCase().endsWith('.xls');

    // Choose the appropriate icon
    const getDocumentIcon = () => {
      if (isExcel) return iconToSvg(FileSpreadsheet, 'md');
      return iconToSvg(FileText, 'md');
    };

    return html`
      <div class="relative group inline-block">
        ${hasPreview
          ? html`
              <div class="relative">
                <img
                  src="data:${isImage ? this.attachment.mimeType : 'image/png'};base64,${this.attachment.preview}"
                  class="w-16 h-16 object-cover rounded-lg border border-input cursor-pointer hover:opacity-80 transition-opacity"
                  alt="${this.attachment.name}"
                  title="${this.attachment.name}"
                  @click=${this.handleClick}
                />
                ${isPdf
                  ? html`
                      <!-- PDF badge overlay -->
                      <div class="absolute bottom-0 left-0 right-0 bg-background/90 px-1 py-0.5 rounded-b-lg">
                        <div class="text-[10px] text-muted-foreground text-center font-medium">PDF</div>
                      </div>
                    `
                  : ''}
              </div>
            `
          : html`
              <!-- Fallback: document icon + filename -->
              <div
                class="w-16 h-16 rounded-lg border border-input cursor-pointer hover:opacity-80 transition-opacity bg-muted text-muted-foreground flex flex-col items-center justify-center p-2"
                @click=${this.handleClick}
                title="${this.attachment.name}"
              >
                ${unsafeHTML(getDocumentIcon())}
                <div class="text-[10px] text-center truncate w-full">
                  ${this.attachment.name.length > 10
                    ? `${this.attachment.name.substring(0, 8)}...`
                    : this.attachment.name}
                </div>
              </div>
            `}
        ${this.showDelete
          ? html`
              <button
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.onDelete?.();
                }}
                class="absolute -top-1 -right-1 w-5 h-5 bg-background hover:bg-muted text-muted-foreground hover:text-foreground rounded-full flex items-center justify-center opacity-100 hover:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity border border-input shadow-sm"
                title="${i18n('Remove')}"
              >
                ${unsafeHTML(iconToSvg(X, 'xs'))}
              </button>
            `
          : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'attachment-tile': AttachmentTile;
  }
}
