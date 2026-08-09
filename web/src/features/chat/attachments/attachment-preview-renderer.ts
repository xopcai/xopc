/**
 * Full-document preview for the attachment dialog (PDF canvas / DOCX HTML / Excel table).
 * Kept separate from the dialog shell so Vite can split this into async chunks.
 */

import {
  EXCEL_PREVIEW_MAX_COLS,
  EXCEL_PREVIEW_MAX_ROWS,
} from '@/features/chat/attachments/attachment-utils-core';
import { isRenderableWorksheet } from '@/features/chat/attachments/excel-worksheet-utils';

let pdfWorkerConfigured = false;

/** First paint: render this many pages, then lazy-load the rest when the viewport nears the sentinel. */
const PDF_INITIAL_PAGE_COUNT = 5;
const PDF_LAZY_PAGE_BATCH = 5;

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

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export type RenderPdfInContainerOptions = {
  loadingText?: string;
  loadMoreHint?: string;
  onPageCount?: (count: number) => void;
};

export async function renderPdfInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
  options?: RenderPdfInContainerOptions,
): Promise<{ cleanup: () => void }> {
  const pdfjsLib = await ensurePdfWorker();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pendingLoadTask: { destroy: () => void } | null = loadingTask;

  container.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'p-4 text-sm text-fg-muted';
  loadingEl.textContent = options?.loadingText ?? '…';
  container.appendChild(loadingEl);

  let pdf: import('pdfjs-dist').PDFDocumentProxy | null = null;
  let observer: IntersectionObserver | null = null;

  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    pendingLoadTask?.destroy();
    pendingLoadTask = null;
    throw e;
  }
  pendingLoadTask = null;

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);
  const pagesHost = document.createElement('div');
  wrapper.appendChild(pagesHost);

  const renderPageElement = async (pageNum: number, numPagesTotal: number) => {
    if (!pdf) return null;
    const page = await pdf.getPage(pageNum);

    const pageContainer = document.createElement('div');
    pageContainer.className = 'mb-4 last:mb-0';
    pageContainer.dataset.pdfPage = String(pageNum);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: 1.5 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    canvas.className =
      'mx-auto block h-auto w-full max-w-full rounded border border-edge bg-white shadow-sm dark:border-edge';

    if (context) {
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page
      .render({
        canvasContext: context!,
        viewport,
        canvas: canvas,
      })
      .promise;

    pageContainer.appendChild(canvas);

    if (pageNum < numPagesTotal) {
      const separator = document.createElement('div');
      separator.className = 'my-4 h-px bg-edge';
      pageContainer.appendChild(separator);
    }

    return pageContainer;
  };

  const appendRenderedPages = async (pageNums: number[], numPagesTotal: number) => {
    const rendered = await Promise.all(
      pageNums.map((pageNum) => renderPageElement(pageNum, numPagesTotal)),
    );
    for (const pageContainer of rendered) {
      if (pageContainer) pagesHost.appendChild(pageContainer);
    }
    await yieldToBrowser();
  };

  const numPages = pdf.numPages;
  options?.onPageCount?.(numPages);
  const initialEnd = Math.min(PDF_INITIAL_PAGE_COUNT, numPages);

  if (initialEnd > 0) {
    await appendRenderedPages(
      Array.from({ length: initialEnd }, (_, i) => i + 1),
      numPages,
    );
  }

  let nextPage = initialEnd + 1;

  if (nextPage <= numPages) {
    const hint = document.createElement('p');
    hint.className = 'py-2 text-center text-xs text-fg-muted';
    hint.textContent = options?.loadMoreHint ?? '';
    wrapper.appendChild(hint);

    const sentinel = document.createElement('div');
    sentinel.className = 'pdf-lazy-sentinel h-12 w-full shrink-0';
    sentinel.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(sentinel);

    let loadingMore = false;
    observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore || !pdf) return;
        loadingMore = true;
        try {
          const batchEnd = Math.min(nextPage + PDF_LAZY_PAGE_BATCH - 1, numPages);
          const batchPageNums = Array.from(
            { length: batchEnd - nextPage + 1 },
            (_, i) => nextPage + i,
          );
          await appendRenderedPages(batchPageNums, numPages);
          nextPage = batchEnd + 1;
          if (nextPage > numPages) {
            observer?.disconnect();
            observer = null;
            hint.remove();
            sentinel.remove();
          }
        } finally {
          loadingMore = false;
        }
      },
      { root: container, rootMargin: '320px', threshold: 0 },
    );
    observer.observe(sentinel);
  }

  return {
    cleanup: () => {
      observer?.disconnect();
      observer = null;
      if (pendingLoadTask) {
        try {
          pendingLoadTask.destroy();
        } catch {
          /* ignore */
        }
        pendingLoadTask = null;
      }
      if (pdf) {
        void loadingTask.destroy();
        pdf = null;
      }
      container.innerHTML = '';
    },
  };
}

export async function renderDocxInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
): Promise<{ cleanup: () => void }> {
  const { renderAsync, defaultOptions } = await import('docx-preview');

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'docx-wrapper-custom max-w-full overflow-x-auto';
  container.appendChild(wrapper);

  await renderAsync(arrayBuffer, wrapper, undefined, {
    ...defaultOptions,
    className: 'docx',
    inWrapper: true,
    ignoreWidth: true,
    ignoreHeight: false,
    // Embedded Word fonts often fail to load in the browser; ignoring them uses system fonts so CJK/Latin render correctly.
    ignoreFonts: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    experimental: false,
    trimXmlDeclaration: true,
    useBase64URL: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });

  const style = document.createElement('style');
  style.textContent = `
    .docx-preview-host { padding: 0; }
    .docx-preview-host .docx-wrapper-custom { max-width: 100%; overflow-x: auto; }
    .docx-preview-host .docx-wrapper { max-width: 100% !important; margin: 0 !important; background: transparent !important; padding: 0em !important; }
    .docx-preview-host .docx-wrapper > section.docx { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 2em !important; background: white !important; color: black !important; max-width: 100% !important; width: 100% !important; min-width: 0 !important; overflow-x: auto !important; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif !important; }
    .docx-preview-host table { max-width: 100% !important; width: auto !important; overflow-x: auto !important; display: block !important; font-family: inherit !important; }
    .docx-preview-host img { max-width: 100% !important; height: auto !important; }
    .docx-preview-host p, .docx-preview-host span, .docx-preview-host div, .docx-preview-host td, .docx-preview-host th { max-width: 100% !important; word-wrap: break-word !important; overflow-wrap: break-word !important; font-family: inherit !important; }
    .docx-preview-host .docx-page-break { display: none !important; }
  `;
  container.classList.add('docx-preview-host');
  container.appendChild(style);

  return {
    cleanup: () => {
      container.innerHTML = '';
      container.classList.remove('docx-preview-host');
    },
  };
}

export type RenderExcelInContainerOptions = {
  truncationNotice?: string;
};

export async function renderExcelInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
  options?: RenderExcelInContainerOptions,
): Promise<{ cleanup: () => void; truncated: boolean }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex h-full min-h-0 flex-col overflow-auto';
  container.appendChild(wrapper);

  const names = workbook.SheetNames ?? [];
  if (names.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'p-4 text-sm text-fg-muted';
    empty.textContent = '(No sheets in workbook.)';
    wrapper.appendChild(empty);
    return {
      truncated: false,
      cleanup: () => {
        container.innerHTML = '';
      },
    };
  }

  let anyTruncated = false;

  if (names.length > 1) {
    const tabContainer = document.createElement('div');
    tabContainer.className =
      'sticky top-0 z-10 mb-4 flex gap-2 border-b border-edge bg-surface-panel dark:border-edge';

    const sheetContents: HTMLElement[] = [];

    names.forEach((sheetName, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = sheetName;
      tab.className =
        index === 0
          ? 'border-b-2 border-accent px-4 py-2 text-sm font-medium text-accent'
          : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-fg-muted hover:border-edge hover:text-fg';

      const sheetDiv = document.createElement('div');
      sheetDiv.style.display = index === 0 ? 'flex' : 'none';
      sheetDiv.className = 'min-h-0 flex-1 overflow-auto';
      const built = buildExcelSheetDomWithXlsx(
        XLSX,
        workbook.Sheets[sheetName],
        sheetName,
        options?.truncationNotice,
      );
      if (built.truncated) anyTruncated = true;
      sheetDiv.appendChild(built.element);
      sheetContents.push(sheetDiv);

      tab.onclick = () => {
        tabContainer.querySelectorAll('button').forEach((btn, btnIndex) => {
          if (btnIndex === index) {
            btn.className =
              'border-b-2 border-accent px-4 py-2 text-sm font-medium text-accent';
          } else {
            btn.className =
              'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-fg-muted hover:border-edge hover:text-fg';
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
    const sheetName = names[0];
    const built = buildExcelSheetDomWithXlsx(
      XLSX,
      workbook.Sheets[sheetName],
      sheetName,
      options?.truncationNotice,
    );
    anyTruncated = built.truncated;
    wrapper.appendChild(built.element);
  }

  return {
    truncated: anyTruncated,
    cleanup: () => {
      container.innerHTML = '';
    },
  };
}

function buildExcelSheetDomWithXlsx(
  XLSX: typeof import('xlsx'),
  worksheet: import('xlsx').WorkSheet | undefined,
  sheetName: string,
  truncationNotice?: string,
): { element: HTMLElement; truncated: boolean } {
  const sheetDiv = document.createElement('div');

  if (!worksheet) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = `Sheet "${sheetName}" is missing from the workbook.`;
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }

  if (!isRenderableWorksheet(worksheet)) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = '(Empty sheet — no cell range.)';
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }

  try {
    const rows: string[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    });

    const rawMaxCol = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const truncated =
      rows.length > EXCEL_PREVIEW_MAX_ROWS || rawMaxCol > EXCEL_PREVIEW_MAX_COLS;

    if (truncated && truncationNotice) {
      const note = document.createElement('p');
      note.className = 'mb-2 border-b border-edge-subtle px-1 pb-2 text-xs text-fg-muted dark:border-edge';
      note.textContent = truncationNotice;
      sheetDiv.appendChild(note);
    }

    const sliced = rows
      .slice(0, EXCEL_PREVIEW_MAX_ROWS)
      .map((row) => row.slice(0, EXCEL_PREVIEW_MAX_COLS));

    const table = document.createElement('table');
    table.className = 'w-full border-collapse text-fg';

    sliced.forEach((row, ri) => {
      const tr = document.createElement('tr');
      if (ri % 2 === 1) {
        tr.className = 'bg-surface-hover/40';
      }
      row.forEach((cell) => {
        const td = document.createElement('td');
        td.className = 'border border-edge px-3 py-2 text-left text-sm dark:border-edge';
        td.textContent = cell === null || cell === undefined ? '' : String(cell);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

    sheetDiv.appendChild(table);
    return { element: sheetDiv, truncated };
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-red-600 dark:text-red-400';
    p.textContent = e instanceof Error ? e.message : String(e);
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }
}
