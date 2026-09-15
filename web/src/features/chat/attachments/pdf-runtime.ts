import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';

export async function ensurePdfWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  // Let Vite emit a worker asset, avoiding cached .mjs responses with the old MIME type.
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs;
}
