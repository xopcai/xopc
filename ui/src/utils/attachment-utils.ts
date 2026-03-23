import { parseAsync } from 'docx-preview';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface Attachment {
  id: string;
  type: 'image' | 'document';
  name: string;
  mimeType: string;
  size: number;
  content: string; // base64 encoded original data (without data URL prefix)
  /** Wire/API payloads may use `data` instead of `content` */
  data?: string;
  extractedText?: string; // For documents: extracted text content
  preview?: string; // base64 image preview (first page for PDFs, or same as content for images)
}

/** Prefer `content`, then `data` (gateway / webchat wire format). */
export function getAttachmentBinaryPayload(att: {
  content?: string;
  data?: string;
}): string | undefined {
  if (typeof att.content === 'string' && att.content.length > 0) return att.content;
  if (typeof att.data === 'string' && att.data.length > 0) return att.data;
  return undefined;
}

/** Same list as `loadAttachment` text branch — keep in sync for preview decode. */
const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.yml',
  '.yaml',
] as const;

function isLikelyTextLikeFile(att: { name?: string; mimeType?: string }): boolean {
  const mime = att.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('text/')) return true;
  if (
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/javascript' ||
    mime === 'application/typescript'
  ) {
    return true;
  }
  const lower = att.name?.toLowerCase() ?? '';
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Text for overlay preview: prefers `extractedText`, otherwise decodes UTF-8 from base64
 * when the attachment is a text-like file (e.g. .md). Webchat only sends `data`, not
 * `extractedText`, so previews would otherwise show empty.
 */
export function extractTextForPreview(att: {
  name?: string;
  mimeType?: string;
  content?: string;
  data?: string;
  extractedText?: string;
}): string | undefined {
  if (att.extractedText != null && att.extractedText !== '') {
    return att.extractedText;
  }
  if (!isLikelyTextLikeFile(att)) return undefined;
  const payload = getAttachmentBinaryPayload(att);
  if (!payload) return undefined;
  try {
    const buf = base64ToArrayBuffer(payload);
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
  } catch {
    return undefined;
  }
}

/**
 * Build a valid `data:` URL for `<img src>` / preview.
 * If payload is already a data URL, returns it unchanged.
 * Otherwise strips whitespace from base64 and uses `mime` (falls back if invalid).
 */
export function resolveDataUrlForDisplay(mime: string, payload: string): string {
  const trimmed = payload.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  const compact = trimmed.replace(/\s/g, '');
  const mimeSafe =
    mime && typeof mime === 'string' && mime.includes('/') ? mime : 'application/octet-stream';
  return `data:${mimeSafe};base64,${compact}`;
}

/**
 * Load an attachment from various sources
 */
export async function loadAttachment(
  source: string | File | Blob | ArrayBuffer,
  name?: string
): Promise<Attachment> {
  let arrayBuffer: ArrayBuffer;
  let detectedFileName = name || 'unnamed';
  let mimeType = 'application/octet-stream';
  let size = 0;

  // Convert source to ArrayBuffer
  if (typeof source === 'string') {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error('Failed to fetch file');
    }
    arrayBuffer = await response.arrayBuffer();
    size = arrayBuffer.byteLength;
    mimeType = response.headers.get('content-type') || mimeType;
    if (!name) {
      const urlParts = source.split('/');
      detectedFileName = urlParts[urlParts.length - 1] || 'document';
    }
  } else if (source instanceof File) {
    arrayBuffer = await source.arrayBuffer();
    size = source.size;
    mimeType = source.type || mimeType;
    detectedFileName = name || source.name;
  } else if (source instanceof Blob) {
    arrayBuffer = await source.arrayBuffer();
    size = source.size;
    mimeType = source.type || mimeType;
  } else if (source instanceof ArrayBuffer) {
    arrayBuffer = source;
    size = source.byteLength;
  } else {
    throw new Error('Invalid source type');
  }

  // Convert ArrayBuffer to base64
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64Content = btoa(binary);

  const id = `${detectedFileName}_${Date.now()}_${Math.random()}`;

  // Process based on file type
  if (mimeType === 'application/pdf' || detectedFileName.toLowerCase().endsWith('.pdf')) {
    const { extractedText, preview } = await processPdf(arrayBuffer, detectedFileName);
    return {
      id,
      type: 'document',
      name: detectedFileName,
      mimeType: 'application/pdf',
      size,
      content: base64Content,
      extractedText,
      preview,
    };
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    detectedFileName.toLowerCase().endsWith('.docx')
  ) {
    const { extractedText } = await processDocx(arrayBuffer, detectedFileName);
    return {
      id,
      type: 'document',
      name: detectedFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size,
      content: base64Content,
      extractedText,
    };
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    detectedFileName.toLowerCase().endsWith('.pptx')
  ) {
    const { extractedText } = await processPptx(arrayBuffer, detectedFileName);
    return {
      id,
      type: 'document',
      name: detectedFileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size,
      content: base64Content,
      extractedText,
    };
  }

  const excelMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];
  if (
    excelMimeTypes.includes(mimeType) ||
    detectedFileName.toLowerCase().endsWith('.xlsx') ||
    detectedFileName.toLowerCase().endsWith('.xls')
  ) {
    const { extractedText } = await processExcel(arrayBuffer, detectedFileName);
    return {
      id,
      type: 'document',
      name: detectedFileName,
      mimeType:
        mimeType && mimeType.startsWith('application/vnd')
        ? mimeType
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size,
      content: base64Content,
      extractedText,
    };
  }

  if (mimeType?.startsWith('image/')) {
    return {
      id,
      type: 'image',
      name: detectedFileName,
      mimeType,
      size,
      content: base64Content,
      preview: base64Content,
    };
  }

  // Text files
  const isTextFile =
    (mimeType?.startsWith('text/') ?? false) ||
    TEXT_FILE_EXTENSIONS.some((ext) => detectedFileName.toLowerCase().endsWith(ext));

  if (isTextFile) {
    const decoder = new TextDecoder();
    const text = decoder.decode(arrayBuffer);
    return {
      id,
      type: 'document',
      name: detectedFileName,
      mimeType: mimeType?.startsWith('text/') ? mimeType : 'text/plain',
      size,
      content: base64Content,
      extractedText: text,
    };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

async function processPdf(
  arrayBuffer: ArrayBuffer,
  name: string
): Promise<{ extractedText: string; preview?: string }> {
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let extractedText = `<pdf filename="${name}">`;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .filter((str: string) => str.trim())
        .join(' ');
      extractedText += `\n<page number="${i}">\n${pageText}\n</page>`;
    }
    extractedText += '\n</pdf>';

    const preview = await generatePdfPreview(pdf);
    return { extractedText, preview };
  } finally {
    if (pdf) {
      pdf.destroy();
    }
  }
}

async function generatePdfPreview(pdf: pdfjsLib.PDFDocumentProxy): Promise<string | undefined> {
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(160 / viewport.width, 160 / viewport.height);
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    canvas.height = scaledViewport.height;
    canvas.width = scaledViewport.width;

    await page.render({
      canvasContext: context,
      viewport: scaledViewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise;

    return canvas.toDataURL('image/png').split(',')[1];
  } catch {
    return undefined;
  }
}

async function processDocx(
  arrayBuffer: ArrayBuffer,
  name: string
): Promise<{ extractedText: string }> {
  try {
    const wordDoc = await parseAsync(arrayBuffer);
    let extractedText = `<docx filename="${name}">\n<page number="1">\n`;

    const body = wordDoc.documentPart?.body;
    if (body?.children) {
      const texts: string[] = [];
      for (const element of body.children) {
        const text = extractTextFromElement(element);
        if (text) texts.push(text);
      }
      extractedText += texts.join('\n');
    }

    extractedText += `\n</page>\n</docx>`;
    return { extractedText };
  } catch (error) {
    throw new Error(`Failed to process DOCX: ${String(error)}`);
  }
}

function extractTextFromElement(element: any): string {
  let text = '';
  const elementType = element.type?.toLowerCase() || '';

  if (elementType === 'paragraph' && element.children) {
    for (const child of element.children) {
      const childType = child.type?.toLowerCase() || '';
      if (childType === 'run' && child.children) {
        for (const textChild of child.children) {
          const textType = textChild.type?.toLowerCase() || '';
          if (textType === 'text') {
            text += textChild.text || '';
          }
        }
      }
    }
  } else if (elementType === 'table') {
    if (element.children) {
      const tableTexts: string[] = [];
      for (const row of element.children) {
        const rowType = row.type?.toLowerCase() || '';
        if (rowType === 'tablerow' && row.children) {
          const rowTexts: string[] = [];
          for (const cell of row.children) {
            const cellType = cell.type?.toLowerCase() || '';
            if (cellType === 'tablecell' && cell.children) {
              const cellTexts: string[] = [];
              for (const cellElement of cell.children) {
                const cellText = extractTextFromElement(cellElement);
                if (cellText) cellTexts.push(cellText);
              }
              if (cellTexts.length > 0) rowTexts.push(cellTexts.join(' '));
            }
          }
          if (rowTexts.length > 0) tableTexts.push(rowTexts.join(' | '));
        }
      }
      if (tableTexts.length > 0) {
        text = `\n[Table]\n${tableTexts.join('\n')}\n[/Table]\n`;
      }
    }
  } else if (element.children && Array.isArray(element.children)) {
    const childTexts: string[] = [];
    for (const child of element.children) {
      const childText = extractTextFromElement(child);
      if (childText) childTexts.push(childText);
    }
    text = childTexts.join(' ');
  }

  return text.trim();
}

async function processPptx(
  arrayBuffer: ArrayBuffer,
  name: string
): Promise<{ extractedText: string }> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    let extractedText = `<pptx filename="${name}">`;

    const slideFiles = Object.keys(zip.files)
      .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const numA = Number.parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
        const numB = Number.parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || '0', 10);
        return numA - numB;
      });

    for (let i = 0; i < slideFiles.length; i++) {
      const slideFile = zip.file(slideFiles[i]);
      if (slideFile) {
        const slideXml = await slideFile.async('text');
        const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);

        if (textMatches) {
          extractedText += `\n<slide number="${i + 1}">`;
          const slideTexts = textMatches
            .map((match) => {
              const textMatch = match.match(/<a:t[^>]*>([^<]+)<\/a:t>/);
              return textMatch ? textMatch[1] : '';
            })
            .filter((t) => t.trim());

          if (slideTexts.length > 0) {
            extractedText += `\n${slideTexts.join('\n')}`;
          }
          extractedText += '\n</slide>';
        }
      }
    }

    extractedText += '\n</pptx>';
    return { extractedText };
  } catch (error) {
    throw new Error(`Failed to process PPTX: ${String(error)}`);
  }
}

async function processExcel(
  arrayBuffer: ArrayBuffer,
  name: string
): Promise<{ extractedText: string }> {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let extractedText = `<excel filename="${name}">`;

    for (const [index, sheetName] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      extractedText += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csvText}\n</sheet>`;
    }

    extractedText += '\n</excel>';
    return { extractedText };
  } catch (error) {
    throw new Error(`Failed to process Excel: ${String(error)}`);
  }
}

/**
 * Get file icon based on mime type
 */
export function getFileIcon(mimeType: string): string {
  if (!mimeType) return '📎';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('text/') || mimeType.includes('json')) return '📃';
  return '📎';
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Convert base64 to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string | undefined | null): ArrayBuffer {
  if (base64 == null || base64 === '') {
    throw new Error('Missing file data');
  }
  // Remove data URL prefix if present
  let base64Data = base64;
  if (base64.startsWith('data:')) {
    const base64Match = base64.match(/base64,(.+)/);
    if (base64Match) {
      base64Data = base64Match[1];
    }
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Check if file is an image
 */
export function isImageFile(mimeType: string): boolean {
  return Boolean(mimeType?.startsWith('image/'));
}

/**
 * Check if file is a document that can be previewed
 */
export function isPreviewableDocument(mimeType: string, name?: string): boolean {
  const previewableTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/json',
    'text/xml',
  ];
  
  if (previewableTypes.includes(mimeType)) return true;
  
  // Check by extension
  if (name) {
    const ext = name.toLowerCase().split('.').pop();
    const previewableExts = ['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts'];
    if (ext && previewableExts.includes(ext)) return true;
  }
  
  return false;
}
