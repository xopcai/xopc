import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { FileSpreadsheet, FileText, X } from 'lucide';
import type { Attachment } from '../utils/attachment-utils';
import {
  arrayBufferToBase64,
  getAttachmentBinaryPayload,
  resolveDataUrlForDisplay,
} from '../utils/attachment-utils';
import { i18n } from '../utils/i18n';
import { apiUrl, authHeaders } from '../chat/helpers.js';

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
  @property({ attribute: false }) authToken?: string;
  @property({ type: Boolean }) showDelete = false;
  @property() onDelete?: () => void;

  @state() private _hydrated: Attachment | null = null;
  private _fetching = false;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private handleClick = () => {
    this.dispatchEvent(
      new CustomEvent('attachment-click', {
        detail: this._effective,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private get _effective(): Attachment {
    return this._hydrated ?? this.attachment;
  }

  override updated(changed: Map<PropertyKey, unknown>): void {
    super.updated(changed);
    if (changed.has('attachment')) {
      this._hydrated = null;
    }
    void this._maybeHydrateFromGateway();
  }

  private async _maybeHydrateFromGateway(): Promise<void> {
    const base = this.attachment;
    if (!base?.workspaceRelativePath || getAttachmentBinaryPayload(base)) {
      return;
    }
    if (!this.authToken || this._fetching || this._hydrated) {
      return;
    }
    this._fetching = true;
    try {
      const url = apiUrl(
        `/api/workspace/inbound-file?rel=${encodeURIComponent(base.workspaceRelativePath)}`,
      );
      const res = await fetch(url, { headers: authHeaders(this.authToken) });
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const isImg = base.mimeType?.startsWith('image/') || base.type === 'image';
      this._hydrated = {
        ...base,
        content: b64,
        data: b64,
        preview: isImg ? b64 : base.preview,
        type: isImg ? 'image' : 'document',
      };
    } catch {
      /* ignore */
    } finally {
      this._fetching = false;
    }
  }

  override render(): TemplateResult {
    const att = this._effective;
    const previewBase64 = att.preview ?? getAttachmentBinaryPayload(att);
    const isImageMime =
      att.mimeType?.startsWith('image/') || att.type === 'image';
    const isPdf = att.mimeType === 'application/pdf';
    const isExcel =
      att.mimeType?.includes('spreadsheetml') ||
      att.name?.toLowerCase().endsWith('.xlsx') ||
      att.name?.toLowerCase().endsWith('.xls');
    const displayName = att.name ?? 'file';
    const imgMime = att.mimeType?.startsWith('image/')
      ? att.mimeType
      : 'image/png';
    const thumbSrc =
      previewBase64 && isImageMime ? resolveDataUrlForDisplay(imgMime, previewBase64) : '';
    const showImageThumb = !!thumbSrc;

    const getDocumentIcon = () => {
      if (isExcel) return iconToSvg(FileSpreadsheet, 'attachment-tile__icon');
      return iconToSvg(FileText, 'attachment-tile__icon');
    };

    return html`
      <div class="attachment-tile-root relative group inline-block">
        ${showImageThumb
          ? html`
              <div class="attachment-tile__preview-wrap">
                <img
                  src="${thumbSrc}"
                  class="attachment-tile__preview-img"
                  alt="${displayName}"
                  title="${displayName}"
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
                title="${displayName}"
              >
                ${unsafeHTML(getDocumentIcon())}
                <div class="attachment-tile__name">${displayName}</div>
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
