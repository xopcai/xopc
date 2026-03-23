import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Download, X } from 'lucide';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { parseAsync } from 'docx-preview';
import type { Attachment } from '../utils/attachment-utils';
import {
  base64ToArrayBuffer,
  extractTextForPreview,
  getAttachmentBinaryPayload,
  resolveDataUrlForDisplay,
} from '../utils/attachment-utils';
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

type FileType = 'image' | 'pdf' | 'docx' | 'pptx' | 'excel' | 'text';

@customElement('attachment-overlay')
export class AttachmentOverlay extends LitElement {
  @state() private attachment?: Attachment;
  @state() private showExtractedText = false;
  @state() private error: string | null = null;

  private currentLoadingTask: any = null;
  private onCloseCallback?: () => void;
  private boundHandleKeyDown?: (e: KeyboardEvent) => void;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  static open(attachment: Attachment, onClose?: () => void) {
    const overlay = new AttachmentOverlay();
    overlay.attachment = attachment;
    overlay.onCloseCallback = onClose;
    document.body.appendChild(overlay);
    overlay.setupEventListeners();
  }

  private setupEventListeners() {
    this.boundHandleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
    window.addEventListener('keydown', this.boundHandleKeyDown);
  }

  private close() {
    this.cleanup();
    if (this.boundHandleKeyDown) {
      window.removeEventListener('keydown', this.boundHandleKeyDown);
    }
    this.onCloseCallback?.();
    this.remove();
  }

  private getFileType(): FileType {
    if (!this.attachment) return 'text';

    if (this.attachment.mimeType?.startsWith('image/')) return 'image';
    if (this.attachment.type === 'image') return 'image';
    if (this.attachment.mimeType === 'application/pdf') return 'pdf';
    if (this.attachment.mimeType?.includes('wordprocessingml')) return 'docx';
    if (
      this.attachment.mimeType?.includes('presentationml') ||
      this.attachment.name?.toLowerCase().endsWith('.pptx')
    )
      return 'pptx';
    if (
      this.attachment.mimeType?.includes('spreadsheetml') ||
      this.attachment.mimeType?.includes('ms-excel') ||
      this.attachment.name?.toLowerCase().endsWith('.xlsx') ||
      this.attachment.name?.toLowerCase().endsWith('.xls')
    )
      return 'excel';

    return 'text';
  }

  private getFileTypeLabel(): string {
    const type = this.getFileType();
    switch (type) {
      case 'pdf':
        return 'PDF';
      case 'docx':
        return 'Document';
      case 'pptx':
        return 'Presentation';
      case 'excel':
        return 'Spreadsheet';
      default:
        return '';
    }
  }

  private handleBackdropClick = () => {
    this.close();
  };

  private handleDownload = () => {
    if (!this.attachment) return;

    const payload = getAttachmentBinaryPayload(this.attachment);
    if (!payload) return;

    const byteCharacters = atob(payload);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: this.attachment.mimeType || 'application/octet-stream' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.attachment.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  private cleanup() {
    this.showExtractedText = false;
    this.error = null;
    if (this.currentLoadingTask) {
      this.currentLoadingTask.destroy();
      this.currentLoadingTask = null;
    }
  }

  override render() {
    if (!this.attachment) return html``;

    return html`
      <div class="attachment-overlay" @click=${this.handleBackdropClick}>
        <div class="attachment-overlay__toolbar" @click=${(e: Event) => e.stopPropagation()}>
          <div class="attachment-overlay__toolbar-inner">
            <div class="attachment-overlay__title-wrap">
              <span class="attachment-overlay__title">${this.attachment.name ?? ''}</span>
            </div>
            <div class="attachment-overlay__actions">
              ${this.renderToggle()}
              <button
                type="button"
                class="attachment-overlay__icon-btn"
                @click=${this.handleDownload}
                title="${i18n('Download')}"
                aria-label="${i18n('Download')}"
              >
                ${unsafeHTML(iconToSvg(Download, 'attachment-overlay__svg'))}
              </button>
              <button
                type="button"
                class="attachment-overlay__icon-btn"
                @click=${() => this.close()}
                title="${i18n('Close')}"
                aria-label="${i18n('Close')}"
              >
                ${unsafeHTML(iconToSvg(X, 'attachment-overlay__svg'))}
              </button>
            </div>
          </div>
        </div>

        <div class="attachment-overlay__body" @click=${(e: Event) => e.stopPropagation()}>
          ${this.renderContent()}
        </div>
      </div>
    `;
  }

  private renderToggle() {
    if (!this.attachment) return html``;

    const fileType = this.getFileType();
    const hasExtractedText = !!this.attachment.extractedText;
    const showToggle = fileType !== 'image' && fileType !== 'text' && fileType !== 'pptx' && hasExtractedText;

    if (!showToggle) return html``;

    const fileTypeLabel = this.getFileTypeLabel();

    return html`
      <div class="attachment-overlay__toggle" role="group" aria-label=${i18n('Text')}>
        <button
          type="button"
          class="attachment-overlay__toggle-btn ${!this.showExtractedText ? 'attachment-overlay__toggle-btn--active' : ''}"
          @click=${() => {
            this.showExtractedText = false;
            this.error = null;
          }}
        >
          ${fileTypeLabel}
        </button>
        <button
          type="button"
          class="attachment-overlay__toggle-btn ${this.showExtractedText ? 'attachment-overlay__toggle-btn--active' : ''}"
          @click=${() => {
            this.showExtractedText = true;
            this.error = null;
          }}
        >
          ${i18n('Text')}
        </button>
      </div>
    `;
  }

  private renderContent() {
    if (!this.attachment) return html``;

    if (this.error) {
      return html`
        <div class="attachment-overlay__error">
          <div class="attachment-overlay__error-title">${i18n('Error loading file')}</div>
          <div class="attachment-overlay__error-msg">${this.error}</div>
        </div>
      `;
    }

    return this.renderFileContent();
  }

  private renderFileContent() {
    if (!this.attachment) return html``;

    const fileType = this.getFileType();

    if (this.showExtractedText && fileType !== 'image') {
      const text =
        extractTextForPreview(this.attachment) || i18n('No text content available');
      return html`
        <div class="attachment-overlay__panel attachment-overlay__panel--text">
          <pre class="attachment-overlay__pre attachment-overlay__pre--sm">${text}</pre>
        </div>
      `;
    }

    switch (fileType) {
      case 'image': {
        const payload = getAttachmentBinaryPayload(this.attachment);
        if (!payload) {
          return html`
            <div class="attachment-overlay__panel attachment-overlay__panel--empty">
              ${i18n('Missing file data')}
            </div>
          `;
        }
        const mime = this.attachment.mimeType?.startsWith('image/')
          ? this.attachment.mimeType
          : 'image/png';
        const imageUrl = resolveDataUrlForDisplay(mime, payload);
        return html`
          <img
            src="${imageUrl}"
            class="attachment-overlay__img"
            alt="${this.attachment.name ?? 'image'}"
          />
        `;
      }

      case 'pdf':
        return html`
          <div id="pdf-container" class="attachment-overlay__doc-container"></div>
        `;

      case 'docx':
        return html`
          <div id="docx-container" class="attachment-overlay__doc-container"></div>
        `;

      case 'excel':
        return html`<div id="excel-container" class="attachment-overlay__doc-container"></div>`;

      case 'pptx':
        return html`
          <div id="pptx-container" class="attachment-overlay__doc-container"></div>
        `;

      default: {
        const text =
          extractTextForPreview(this.attachment) || i18n('No content available');
        return html`
          <div class="attachment-overlay__panel attachment-overlay__panel--text">
            <pre class="attachment-overlay__pre">${text}</pre>
          </div>
        `;
      }
    }
  }

  override async updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    if (
      (changedProperties.has('attachment') || changedProperties.has('showExtractedText')) &&
      this.attachment &&
      !this.showExtractedText &&
      !this.error
    ) {
      const fileType = this.getFileType();

      switch (fileType) {
        case 'pdf':
          await this.renderPdf();
          break;
        case 'docx':
          await this.renderDocx();
          break;
        case 'excel':
          await this.renderExcel();
          break;
        case 'pptx':
          await this.renderExtractedText();
          break;
      }
    }
  }

  private async renderPdf() {
    const container = this.querySelector('#pdf-container');
    if (!container || !this.attachment) return;

    let pdf: any = null;

    try {
      const payload = getAttachmentBinaryPayload(this.attachment);
      if (!payload) {
        this.error = i18n('Missing file data');
        return;
      }
      const arrayBuffer = base64ToArrayBuffer(payload);

      if (this.currentLoadingTask) {
        this.currentLoadingTask.destroy();
      }

      this.currentLoadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      pdf = await this.currentLoadingTask.promise;
      this.currentLoadingTask = null;

      container.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = '';
      container.appendChild(wrapper);

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        const pageContainer = document.createElement('div');
        pageContainer.className = 'mb-4 last:mb-0';

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        canvas.className = 'w-full max-w-full h-auto block mx-auto bg-white rounded shadow-sm border border-border';

        if (context) {
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }

        await page.render({
          canvasContext: context!,
          viewport: viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        }).promise;

        pageContainer.appendChild(canvas);

        if (pageNum < pdf.numPages) {
          const separator = document.createElement('div');
          separator.className = 'h-px bg-border my-4';
          pageContainer.appendChild(separator);
        }

        wrapper.appendChild(pageContainer);
      }
    } catch (error: any) {
      console.error('Error rendering PDF:', error);
      this.error = error?.message || i18n('Failed to load PDF');
    } finally {
      if (pdf) {
        pdf.destroy();
      }
    }
  }

  private async renderDocx() {
    const container = this.querySelector('#docx-container');
    if (!container || !this.attachment) return;

    try {
      const payload = getAttachmentBinaryPayload(this.attachment);
      if (!payload) {
        this.error = i18n('Missing file data');
        return;
      }
      const arrayBuffer = base64ToArrayBuffer(payload);

      container.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'docx-wrapper-custom';
      container.appendChild(wrapper);

      // Use renderAsync with proper type casting
      const options = {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: true,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
      };
      await (parseAsync as any)(arrayBuffer, wrapper as HTMLElement, undefined, options);

      const style = document.createElement('style');
      style.textContent = `
        #docx-container { padding: 0; }
        #docx-container .docx-wrapper-custom { max-width: 100%; overflow-x: auto; }
        #docx-container .docx-wrapper { max-width: 100% !important; margin: 0 !important; background: transparent !important; padding: 0em !important; }
        #docx-container .docx-wrapper > section.docx { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 2em !important; background: white !important; color: black !important; max-width: 100% !important; width: 100% !important; min-width: 0 !important; overflow-x: auto !important; }
        #docx-container table { max-width: 100% !important; width: auto !important; overflow-x: auto !important; display: block !important; }
        #docx-container img { max-width: 100% !important; height: auto !important; }
        #docx-container p, #docx-container span, #docx-container div { max-width: 100% !important; word-wrap: break-word !important; overflow-wrap: break-word !important; }
        #docx-container .docx-page-break { display: none !important; }
      `;
      container.appendChild(style);
    } catch (error: any) {
      console.error('Error rendering DOCX:', error);
      this.error = error?.message || i18n('Failed to load document');
    }
  }

  private async renderExcel() {
    const container = this.querySelector('#excel-container');
    if (!container || !this.attachment) return;

    try {
      const payload = getAttachmentBinaryPayload(this.attachment);
      if (!payload) {
        this.error = i18n('Missing file data');
        return;
      }
      const arrayBuffer = base64ToArrayBuffer(payload);
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      container.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'overflow-auto h-full flex flex-col';
      container.appendChild(wrapper);

      if (workbook.SheetNames.length > 1) {
        const tabContainer = document.createElement('div');
        tabContainer.className = 'flex gap-2 mb-4 border-b border-border sticky top-0 bg-card z-10';

        const sheetContents: HTMLElement[] = [];

        workbook.SheetNames.forEach((sheetName, index) => {
          const tab = document.createElement('button');
          tab.textContent = sheetName;
          tab.className =
            index === 0
              ? 'px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary'
              : 'px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-b-2 hover:border-border transition-colors';

          const sheetDiv = document.createElement('div');
          sheetDiv.style.display = index === 0 ? 'flex' : 'none';
          sheetDiv.className = 'flex-1 overflow-auto';
          sheetDiv.appendChild(this.renderExcelSheet(workbook.Sheets[sheetName], sheetName));
          sheetContents.push(sheetDiv);

          tab.onclick = () => {
            tabContainer.querySelectorAll('button').forEach((btn, btnIndex) => {
              if (btnIndex === index) {
                btn.className = 'px-4 py-2 text-sm font-medium border-b-2 border-primary text-primary';
              } else {
                btn.className =
                  'px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-b-2 hover:border-border transition-colors';
              }
            });
            sheetContents.forEach((content, contentIndex) => {
              content.style.display = contentIndex === index ? 'flex' : 'none';
            });
          };

          tabContainer.appendChild(tab);
        });

        wrapper.appendChild(tabContainer);
        sheetContents.forEach((content) => {
          wrapper.appendChild(content);
        });
      } else {
        const sheetName = workbook.SheetNames[0];
        wrapper.appendChild(this.renderExcelSheet(workbook.Sheets[sheetName], sheetName));
      }
    } catch (error: any) {
      console.error('Error rendering Excel:', error);
      this.error = error?.message || i18n('Failed to load spreadsheet');
    }
  }

  private renderExcelSheet(worksheet: any, sheetName: string): HTMLElement {
    const sheetDiv = document.createElement('div');

    const htmlTable = XLSX.utils.sheet_to_html(worksheet, { id: `sheet-${sheetName}` });
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlTable;

    const table = tempDiv.querySelector('table');
    if (table) {
      table.className = 'w-full border-collapse text-foreground';

      table.querySelectorAll('td, th').forEach((cell) => {
        const cellEl = cell as HTMLElement;
        cellEl.className = 'border border-border px-3 py-2 text-sm text-left';
      });

      const headerCells = table.querySelectorAll('thead th, tr:first-child td');
      if (headerCells.length > 0) {
        headerCells.forEach((th) => {
          const thEl = th as HTMLElement;
          thEl.className =
            'border border-border px-3 py-2 text-sm font-semibold bg-muted text-foreground sticky top-0';
        });
      }

      table.querySelectorAll('tbody tr:nth-child(even)').forEach((row) => {
        const rowEl = row as HTMLElement;
        rowEl.className = 'bg-muted/30';
      });

      sheetDiv.appendChild(table);
    }

    return sheetDiv;
  }

  private async renderExtractedText() {
    const container = this.querySelector('#pptx-container');
    if (!container || !this.attachment) return;

    try {
      container.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'p-6 overflow-auto';

      const pre = document.createElement('pre');
      pre.className = 'whitespace-pre-wrap text-sm text-foreground font-mono';
      pre.textContent =
        extractTextForPreview(this.attachment) || i18n('No text content available');

      wrapper.appendChild(pre);
      container.appendChild(wrapper);
    } catch (error: any) {
      console.error('Error rendering extracted text:', error);
      this.error = error?.message || i18n('Failed to display text content');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'attachment-overlay': AttachmentOverlay;
  }
}
