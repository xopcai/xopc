# Chat UI Refactor Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** 重构 xopcbot 的 Chat UI，使其像 pi-web-ui 一样支持各种文件格式（PDF、DOCX、Excel、图片等）的预览和处理，并改进 SSE 消息格式。

**Architecture:** 
- 参考 pi-web-ui 的组件架构，引入 AttachmentTile、AttachmentOverlay、Artifacts 等组件
- 增强 attachment-utils 支持 PDF.js、docx-preview、xlsx 等文件处理库
- 保持与现有 gateway SSE 数据流的兼容性，同时支持更丰富的消息格式

**Tech Stack:** 
- Lit (Web Components)
- pdfjs-dist (PDF 预览)
- docx-preview (Word 文档预览)
- xlsx (Excel 预览)
- jszip (PPTX 处理)

---

## Phase 1: 添加文件处理依赖

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Modify: `ui/package.json`

**Step 1: 添加依赖**

```json
{
  "dependencies": {
    "@lit-labs/virtualizer": "^2.1.1",
    "lit": "^3.3.2",
    "lucide": "^0.456.0",
    "zustand": "^4.5.0",
    "pdfjs-dist": "^5.4.394",
    "docx-preview": "^0.3.7",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
    "jszip": "^3.10.1"
  }
}
```

**Step 2: 安装依赖**

Run: `cd /Users/micjoyce/develop/github/xopcbot/ui && pnpm install`

Expected: Dependencies installed successfully

**Step 3: Commit**

```bash
git add ui/package.json pnpm-lock.yaml
git commit -m "deps(ui): add file processing libraries (pdfjs, docx-preview, xlsx, jszip)"
```

---

## Phase 2: 增强 Attachment 类型和文件处理工具

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `ui/src/utils/attachment-utils.ts` (overwrite)
- Create: `ui/src/utils/file-processors.ts`

**Step 1: 创建增强的 attachment-utils.ts**

```typescript
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
  fileName: string;
  mimeType: string;
  size: number;
  content: string; // base64 encoded original data (without data URL prefix)
  extractedText?: string; // For documents: extracted text content
  preview?: string; // base64 image preview (first page for PDFs, or same as content for images)
}

/**
 * Load an attachment from various sources
 */
export async function loadAttachment(
  source: string | File | Blob | ArrayBuffer,
  fileName?: string
): Promise<Attachment> {
  let arrayBuffer: ArrayBuffer;
  let detectedFileName = fileName || 'unnamed';
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
    if (!fileName) {
      const urlParts = source.split('/');
      detectedFileName = urlParts[urlParts.length - 1] || 'document';
    }
  } else if (source instanceof File) {
    arrayBuffer = await source.arrayBuffer();
    size = source.size;
    mimeType = source.type || mimeType;
    detectedFileName = fileName || source.name;
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
      fileName: detectedFileName,
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
      fileName: detectedFileName,
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
      fileName: detectedFileName,
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
      fileName: detectedFileName,
      mimeType: mimeType.startsWith('application/vnd')
        ? mimeType
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size,
      content: base64Content,
      extractedText,
    };
  }

  if (mimeType.startsWith('image/')) {
    return {
      id,
      type: 'image',
      fileName: detectedFileName,
      mimeType,
      size,
      content: base64Content,
      preview: base64Content,
    };
  }

  // Text files
  const textExtensions = [
    '.txt', '.md', '.json', '.xml', '.html', '.css', '.js', '.ts',
    '.jsx', '.tsx', '.yml', '.yaml',
  ];
  const isTextFile =
    mimeType.startsWith('text/') ||
    textExtensions.some((ext) => detectedFileName.toLowerCase().endsWith(ext));

  if (isTextFile) {
    const decoder = new TextDecoder();
    const text = decoder.decode(arrayBuffer);
    return {
      id,
      type: 'document',
      fileName: detectedFileName,
      mimeType: mimeType.startsWith('text/') ? mimeType : 'text/plain',
      size,
      content: base64Content,
      extractedText: text,
    };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

async function processPdf(
  arrayBuffer: ArrayBuffer,
  fileName: string
): Promise<{ extractedText: string; preview?: string }> {
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let extractedText = `<pdf filename="${fileName}">`;
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
    }).promise;

    return canvas.toDataURL('image/png').split(',')[1];
  } catch {
    return undefined;
  }
}

async function processDocx(
  arrayBuffer: ArrayBuffer,
  fileName: string
): Promise<{ extractedText: string }> {
  try {
    const wordDoc = await parseAsync(arrayBuffer);
    let extractedText = `<docx filename="${fileName}">\n<page number="1">\n`;

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
  fileName: string
): Promise<{ extractedText: string }> {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    let extractedText = `<pptx filename="${fileName}">`;

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
  fileName: string
): Promise<{ extractedText: string }> {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let extractedText = `<excel filename="${fileName}">`;

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
```

**Step 2: Commit**

```bash
git add ui/src/utils/attachment-utils.ts
git commit -m "feat(ui): enhance attachment utils with file processing support"
```

---

## Phase 3: 重构 MessageEditor 支持完整附件功能

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `ui/src/components/MessageEditor.ts`

**Step 1: 更新 MessageEditor 使用新的 attachment-utils**

参考 pi-web-ui 的 Input.ts 和 Messages.ts，重构 MessageEditor 以支持：
1. 拖拽上传
2. 粘贴图片
3. 文件类型检测
4. 附件预览

**Step 2: Commit**

```bash
git add ui/src/components/MessageEditor.ts
git commit -m "refactor(ui): enhance MessageEditor with full attachment support"
```

---

## Phase 4: 创建 AttachmentTile 组件

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `ui/src/components/AttachmentTile.ts`

**Step 1: 创建 AttachmentTile 组件**

参考 pi-web-ui/src/components/AttachmentTile.ts，创建缩略图组件：
- 图片预览
- 文档图标
- 删除按钮
- 点击打开大图/预览

**Step 2: Commit**

```bash
git add ui/src/components/AttachmentTile.ts
git commit -m "feat(ui): add AttachmentTile component for file thumbnails"
```

---

## Phase 5: 创建 AttachmentOverlay 组件

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `ui/src/dialogs/AttachmentOverlay.ts`

**Step 1: 创建 AttachmentOverlay 组件**

参考 pi-web-ui/src/dialogs/AttachmentOverlay.ts，创建全屏预览组件：
- PDF 渲染 (pdfjs-dist)
- DOCX 渲染 (docx-preview)
- Excel 渲染 (xlsx)
- 图片预览
- 文本内容切换

**Step 2: Commit**

```bash
git add ui/src/dialogs/AttachmentOverlay.ts
git commit -m "feat(ui): add AttachmentOverlay component for file preview"
```

---

## Phase 6: 重构 MessageList 和 MessageBubble 支持附件渲染

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `ui/src/components/MessageList/index.ts`
- Modify: `ui/src/components/MessageList/MessageBubble.ts`
- Modify: `ui/src/components/MessageList/AttachmentRenderer.ts`

**Step 1: 更新 AttachmentRenderer**

增强 AttachmentRenderer 以使用新的 AttachmentTile 组件。

**Step 2: 更新 MessageBubble**

集成 AttachmentRenderer，支持附件点击打开 AttachmentOverlay。

**Step 3: Commit**

```bash
git add ui/src/components/MessageList/
git commit -m "refactor(ui): enhance MessageList with attachment rendering"
```

---

## Phase 7: 创建 Artifacts 系统组件

**TDD scenario:** New feature — full TDD cycle

**Files:**
- Create: `ui/src/components/artifacts/ArtifactElement.ts`
- Create: `ui/src/components/artifacts/HtmlArtifact.ts`
- Create: `ui/src/components/artifacts/MarkdownArtifact.ts`
- Create: `ui/src/components/artifacts/ImageArtifact.ts`
- Create: `ui/src/components/artifacts/PdfArtifact.ts`
- Create: `ui/src/components/artifacts/DocxArtifact.ts`
- Create: `ui/src/components/artifacts/ExcelArtifact.ts`
- Create: `ui/src/components/artifacts/SvgArtifact.ts`
- Create: `ui/src/components/artifacts/TextArtifact.ts`
- Create: `ui/src/components/artifacts/GenericArtifact.ts`
- Create: `ui/src/components/artifacts/ArtifactsPanel.ts`
- Create: `ui/src/components/artifacts/index.ts`

**Step 1: 创建基础 ArtifactElement 抽象类**

**Step 2: 创建各个文件类型的 Artifact 组件**

**Step 3: 创建 ArtifactsPanel 组件**

**Step 4: Commit**

```bash
git add ui/src/components/artifacts/
git commit -m "feat(ui): add Artifacts system for generated file preview"
```

---

## Phase 8: 更新 Gateway Chat 集成新组件

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `ui/src/gateway-chat.ts`

**Step 1: 集成 ArtifactsPanel**

参考 pi-web-ui/src/ChatPanel.ts，在 GatewayChat 中集成 ArtifactsPanel。

**Step 2: 更新消息处理**

支持新的消息格式和附件处理。

**Step 3: Commit**

```bash
git add ui/src/gateway-chat.ts
git commit -m "feat(ui): integrate ArtifactsPanel into GatewayChat"
```

---

## Phase 9: 后端 SSE 消息格式适配

**TDD scenario:** Modifying tested code — run existing tests first

**Files:**
- Modify: `src/gateway/hono/sse.ts` (如果需要)
- Modify: `src/gateway/service.ts` (如果需要)

**Step 1: 检查现有 SSE 格式**

确保后端 SSE 消息格式支持附件信息传递。

**Step 2: 如有需要，更新消息格式**

**Step 3: Commit**

```bash
git add src/gateway/
git commit -m "feat(gateway): adapt SSE message format for attachments"
```

---

## Phase 10: 测试和验证

**TDD scenario:** Use judgment

**Files:**
- All modified files

**Step 1: 运行类型检查**

Run: `cd /Users/micjoyce/develop/github/xopcbot/ui && pnpm run type-check`

**Step 2: 构建测试**

Run: `cd /Users/micjoyce/develop/github/xopcbot/ui && pnpm run build`

**Step 3: 手动测试**

1. 启动 gateway: `pnpm run dev -- gateway`
2. 访问 UI: `http://localhost:18790`
3. 测试文件上传:
   - 图片 (PNG, JPG)
   - PDF
   - DOCX
   - Excel
   - 文本文件
4. 测试 Artifacts 生成

**Step 4: Commit**

```bash
git commit -m "chore(ui): verify build and functionality"
```

---

## Summary

This plan refactors the xopcbot Chat UI to match pi-web-ui's capabilities:

1. **File Processing**: PDF, DOCX, Excel, PPTX, images, text files
2. **Attachment UI**: Tiles, overlays, previews
3. **Artifacts System**: Generated file preview and management
4. **SSE Integration**: Maintains compatibility with existing gateway

The implementation follows the reference architecture from pi-web-ui while adapting to xopcbot's existing gateway and session management system.
