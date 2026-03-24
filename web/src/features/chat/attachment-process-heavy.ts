/**
 * Heavy parsers (pdfjs, docx-preview, jszip, xlsx) — imported dynamically from `loadAttachment`
 * and attachment preview dialog to keep the main bundle smaller.
 */

import { safeSheetToCsv } from '@/features/chat/excel-worksheet-utils';
import type { PDFDocumentProxy } from 'pdfjs-dist';

let pdfWorkerConfigured = false;

async function ensurePdfWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfWorkerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    pdfWorkerConfigured = true;
  }
  return pdfjsLib;
}

export async function processPdf(
  arrayBuffer: ArrayBuffer,
  name: string,
): Promise<{ extractedText: string; preview?: string }> {
  const pdfjsLib = await ensurePdfWorker();
  let pdf: PDFDocumentProxy | null = null;
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let extractedText = `<pdf filename="${name}">`;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((str) => str.trim())
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

async function generatePdfPreview(pdf: PDFDocumentProxy): Promise<string | undefined> {
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

    await page
      .render({
        canvasContext: context,
        viewport: scaledViewport,
        canvas: canvas as unknown as HTMLCanvasElement,
      })
      .promise;

    return canvas.toDataURL('image/png').split(',')[1];
  } catch {
    return undefined;
  }
}

export async function processDocx(
  arrayBuffer: ArrayBuffer,
  name: string,
): Promise<{ extractedText: string }> {
  const { parseAsync } = await import('docx-preview');
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

function extractTextFromElement(element: unknown): string {
  const el = element as {
    type?: string;
    children?: unknown[];
    text?: string;
  };
  let text = '';
  const elementType = el.type?.toLowerCase() || '';

  if (elementType === 'paragraph' && el.children) {
    for (const child of el.children) {
      const c = child as { type?: string; children?: unknown[] };
      const childType = c.type?.toLowerCase() || '';
      if (childType === 'run' && c.children) {
        for (const textChild of c.children) {
          const tc = textChild as { type?: string; text?: string };
          const textType = tc.type?.toLowerCase() || '';
          if (textType === 'text') {
            text += tc.text || '';
          }
        }
      }
    }
  } else if (elementType === 'table') {
    if (el.children) {
      const tableTexts: string[] = [];
      for (const row of el.children) {
        const r = row as { type?: string; children?: unknown[] };
        const rowType = r.type?.toLowerCase() || '';
        if (rowType === 'tablerow' && r.children) {
          const rowTexts: string[] = [];
          for (const cell of r.children) {
            const cellEl = cell as { type?: string; children?: unknown[] };
            const cellType = cellEl.type?.toLowerCase() || '';
            if (cellType === 'tablecell' && cellEl.children) {
              const cellTexts: string[] = [];
              for (const cellElement of cellEl.children) {
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
  } else if (el.children && Array.isArray(el.children)) {
    const childTexts: string[] = [];
    for (const child of el.children) {
      const childText = extractTextFromElement(child);
      if (childText) childTexts.push(childText);
    }
    text = childTexts.join(' ');
  }

  return text.trim();
}

export async function processPptx(
  arrayBuffer: ArrayBuffer,
  name: string,
): Promise<{ extractedText: string }> {
  const JSZip = (await import('jszip')).default;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    let extractedText = `<pptx filename="${name}">`;

    const slideFiles = Object.keys(zip.files)
      .filter((n) => n.match(/ppt\/slides\/slide\d+\.xml$/))
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

export async function processExcel(
  arrayBuffer: ArrayBuffer,
  name: string,
): Promise<{ extractedText: string }> {
  const XLSX = await import('xlsx');
  try {
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let extractedText = `<excel filename="${name}">`;

    const names = workbook.SheetNames ?? [];
    for (const [index, sheetName] of names.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      const csvText = safeSheetToCsv(XLSX, worksheet, sheetName);
      extractedText += `\n<sheet name="${sheetName}" index="${index + 1}">\n${csvText}\n</sheet>`;
    }

    extractedText += '\n</excel>';
    return { extractedText };
  } catch (error) {
    throw new Error(`Failed to process Excel: ${String(error)}`);
  }
}
