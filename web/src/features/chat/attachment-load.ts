import { isTextLikeFileNameAndMime, type Attachment } from '@/features/chat/attachment-utils-core';

/**
 * Load an attachment from various sources. Heavy parsers load via dynamic `import()` per file type.
 */
export async function loadAttachment(
  source: string | File | Blob | ArrayBuffer,
  name?: string,
): Promise<Attachment> {
  let arrayBuffer: ArrayBuffer;
  let detectedFileName = name || 'unnamed';
  let mimeType = 'application/octet-stream';
  let size = 0;

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

  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64Content = btoa(binary);

  const id = `${detectedFileName}_${Date.now()}_${Math.random()}`;

  if (mimeType === 'application/pdf' || detectedFileName.toLowerCase().endsWith('.pdf')) {
    const { processPdf } = await import('@/features/chat/attachment-process-heavy');
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
    const { processDocx } = await import('@/features/chat/attachment-process-heavy');
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
    const { processPptx } = await import('@/features/chat/attachment-process-heavy');
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
    const { processExcel } = await import('@/features/chat/attachment-process-heavy');
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

  const isTextFile = isTextLikeFileNameAndMime(detectedFileName, mimeType ?? '');

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
