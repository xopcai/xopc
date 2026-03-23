import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { FileSpreadsheet, FileText, X } from 'lucide';
import type { Attachment } from '../utils/attachment-utils';
import { i18n } from '../utils/i18n';

function iconToSvg(iconData: unknown, sizeClass = ''): string {
  if (!iconData || !Array.isArray(iconData)) return '';

  const [_tag, attrs, children] = iconData as [string, Record<string, string>, unknown[]];

  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const childrenStr = Array.isArray(children)
    ? children
        .map((child) => {
          if (Array.isArray(child)) {
            const [cTag, cAttrs] = child;
            const cAttrStr = Object.entries(cAttrs || {})
              .map(([k, v]) => `${k}="${v}"`)
              .join(' ');
            return `<${cTag} ${cAttrStr} />`;
          }
          return '';
        })
        .join('')
    : '';

  const finalAttrs = sizeClass ? `${attrStr} class="${sizeClass}"` : attrStr;

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

  private handleClick = () => {
    this.dispatchEvent(
      new CustomEvent('attachment-click', {
        detail: this.attachment,
        bubbles: true,
        composed: true,
      }),
    );
  };

  override render(): TemplateResult {
    const hasPreview = !!this.attachment.preview;
    const isImage = this.attachment.type === 'image';
    const isPdf = this.attachment.mimeType === 'application/pdf';
    const isExcel =
      this.attachment.mimeType?.includes('spreadsheetml') ||
      this.attachment.name.toLowerCase().endsWith('.xlsx') ||
      this.attachment.name.toLowerCase().endsWith('.xls');

    const getDocumentIcon = () => {
      if (isExcel) return iconToSvg(FileSpreadsheet, 'attachment-tile__icon');
      return iconToSvg(FileText, 'attachment-tile__icon');
    };

    return html`
      <div class="attachment-tile-root relative group inline-block">
        ${hasPreview
          ? html`
              <div class="attachment-tile__preview-wrap">
                <img
                  src="data:${isImage ? this.attachment.mimeType : 'image/png'};base64,${this.attachment.preview}"
                  class="attachment-tile__preview-img"
                  alt="${this.attachment.name}"
                  title="${this.attachment.name}"
                  @click=${this.handleClick}
                />
                ${isPdf
                  ? html`
                      <div class="attachment-tile__pdf-badge" aria-hidden="true">
                        <span>PDF</span>
                      </div>
                    `
                  : ''}
              </div>
            `
          : html`
              <div
                class="attachment-tile__doc"
                @click=${this.handleClick}
                title="${this.attachment.name}"
              >
                ${unsafeHTML(getDocumentIcon())}
                <div class="attachment-tile__name">${this.attachment.name}</div>
              </div>
            `}
        ${this.showDelete
          ? html`
              <button
                type="button"
                class="attachment-tile__remove"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.onDelete?.();
                }}
                title="${i18n('Remove')}"
              >
                ${unsafeHTML(iconToSvg(X, 'attachment-tile__remove-icon'))}
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
