import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getDocumentIcon } from '../../utils/icons';
import { t } from '../../utils/i18n';
import type { Attachment } from './types';

@customElement('attachment-renderer')
export class AttachmentRenderer extends LitElement {
  @property({ attribute: false }) attachments: Attachment[] = [];

  createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override render(): unknown {
    if (!this.attachments?.length) return null;

    const images = this.attachments.filter(att => 
      att.type === 'image' || att.mimeType?.startsWith('image/')
    );
    const documents = this.attachments.filter(att => 
      att.type !== 'image' && !att.mimeType?.startsWith('image/')
    );

    return html`
      <div class="flex flex-col gap-2 mt-2">
        ${images.length > 0 ? this._renderImageGallery(images) : ''}
        ${documents.length > 0 ? this._renderDocumentList(documents) : ''}
      </div>
    `;
  }

  private _renderImageGallery(images: Attachment[]): unknown {
    const count = images.length;
    let galleryClass = 'single';
    if (count === 2) galleryClass = 'double';
    else if (count === 3) galleryClass = 'triple';
    else if (count >= 4) galleryClass = 'quad';

    return html`
      <div class="image-gallery ${galleryClass}">
        ${images.map((img) => html`
          <img 
            src="${img.data || img.content}" 
            alt="${img.name || t('fileUpload.image')}" 
            @click=${() => this._handleImageClick(img)}
          />
        `)}
      </div>
    `;
  }

  private _renderDocumentList(documents: Attachment[]): unknown {
    return html`
      <div class="flex flex-col gap-2">
        ${documents.map((doc) => this._renderDocumentPreview(doc))}
      </div>
    `;
  }

  private _renderDocumentPreview(doc: Attachment): unknown {
    const name = doc.name || t('fileUpload.document');
    const size = doc.size ? this._formatFileSize(doc.size) : '';

    return html`
      <div class="document-preview" @click=${() => this._handleDocumentClick(doc)}>
        <div class="icon">${getDocumentIcon(doc.mimeType || '')}</div>
        <div class="info">
          <div class="name">${name}</div>
          <div class="meta">${size || doc.mimeType || t('fileUpload.unknown')}</div>
        </div>
      </div>
    `;
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

  private _handleImageClick(img: Attachment): void {
    // Dispatch event for parent to handle (e.g., open lightbox)
    this.dispatchEvent(new CustomEvent('image-click', { 
      detail: img,
      bubbles: true,
      composed: true 
    }));
  }

  private _handleDocumentClick(doc: Attachment): void {
    this.dispatchEvent(new CustomEvent('document-click', { 
      detail: doc,
      bubbles: true,
      composed: true 
    }));
  }
}
