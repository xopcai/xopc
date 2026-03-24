/**
 * Full-document preview for the attachment dialog (PDF canvas / DOCX HTML / Excel table).
 * Kept separate from the dialog shell so Vite can split this into async chunks.
 */

import { isRenderableWorksheet } from '@/features/chat/excel-worksheet-utils';

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

export async function renderPdfInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
): Promise<{ cleanup: () => void }> {
  const pdfjsLib = await ensurePdfWorker();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  container.innerHTML = '';
  const wrapper = document.createElement('div');
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
        canvas: canvas as unknown as HTMLCanvasElement,
      })
      .promise;

    pageContainer.appendChild(canvas);

    if (pageNum < pdf.numPages) {
      const separator = document.createElement('div');
      separator.className = 'my-4 h-px bg-edge';
      pageContainer.appendChild(separator);
    }

    wrapper.appendChild(pageContainer);
  }

  return {
    cleanup: () => {
      pdf.destroy();
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
  });

  const style = document.createElement('style');
  style.textContent = `
    .docx-preview-host { padding: 0; }
    .docx-preview-host .docx-wrapper-custom { max-width: 100%; overflow-x: auto; }
    .docx-preview-host .docx-wrapper { max-width: 100% !important; margin: 0 !important; background: transparent !important; padding: 0em !important; }
    .docx-preview-host .docx-wrapper > section.docx { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 2em !important; background: white !important; color: black !important; max-width: 100% !important; width: 100% !important; min-width: 0 !important; overflow-x: auto !important; }
    .docx-preview-host table { max-width: 100% !important; width: auto !important; overflow-x: auto !important; display: block !important; }
    .docx-preview-host img { max-width: 100% !important; height: auto !important; }
    .docx-preview-host p, .docx-preview-host span, .docx-preview-host div { max-width: 100% !important; word-wrap: break-word !important; overflow-wrap: break-word !important; }
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

export async function renderExcelInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
): Promise<{ cleanup: () => void }> {
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
      cleanup: () => {
        container.innerHTML = '';
      },
    };
  }

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
      sheetDiv.appendChild(buildExcelSheetDomWithXlsx(XLSX, workbook.Sheets[sheetName], sheetName));
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
    wrapper.appendChild(buildExcelSheetDomWithXlsx(XLSX, workbook.Sheets[sheetName], sheetName));
  }

  return {
    cleanup: () => {
      container.innerHTML = '';
    },
  };
}

function buildExcelSheetDomWithXlsx(
  XLSX: typeof import('xlsx'),
  worksheet: import('xlsx').WorkSheet | undefined,
  sheetName: string,
): HTMLElement {
  const sheetDiv = document.createElement('div');

  if (!worksheet) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = `Sheet "${sheetName}" is missing from the workbook.`;
    sheetDiv.appendChild(p);
    return sheetDiv;
  }

  if (!isRenderableWorksheet(worksheet)) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = '(Empty sheet — no cell range.)';
    sheetDiv.appendChild(p);
    return sheetDiv;
  }

  let htmlTable: string;
  try {
    htmlTable = XLSX.utils.sheet_to_html(worksheet, { id: `sheet-${sheetName}` });
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-red-600 dark:text-red-400';
    p.textContent = e instanceof Error ? e.message : String(e);
    sheetDiv.appendChild(p);
    return sheetDiv;
  }

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlTable;

  const table = tempDiv.querySelector('table');
  if (table) {
    table.className = 'w-full border-collapse text-fg';

    table.querySelectorAll('td, th').forEach((cell) => {
      const cellEl = cell as HTMLElement;
      cellEl.className = 'border border-edge px-3 py-2 text-left text-sm dark:border-edge';
    });

    const headerCells = table.querySelectorAll('thead th, tr:first-child td');
    if (headerCells.length > 0) {
      headerCells.forEach((th) => {
        const thEl = th as HTMLElement;
        thEl.className =
          'sticky top-0 border border-edge bg-surface-hover px-3 py-2 text-sm font-semibold text-fg dark:border-edge';
      });
    }

    table.querySelectorAll('tbody tr:nth-child(even)').forEach((row) => {
      const rowEl = row as HTMLElement;
      rowEl.className = 'bg-surface-hover/40';
    });

    sheetDiv.appendChild(table);
  } else {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = '(Could not build table for this sheet.)';
    sheetDiv.appendChild(p);
  }

  return sheetDiv;
}
