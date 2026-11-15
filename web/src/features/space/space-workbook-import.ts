import type { IWorkbookData } from '@univerjs/presets';

export const supportedWorkbookFile = (fileName: string) => /\.(xlsx|csv|tsv)$/i.test(fileName);

export async function readWorkbookFile(file: Blob, fileName: string): Promise<IWorkbookData> {
  if (file.size > 4 * 1024 * 1024) throw new Error('limits');
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL('./space-workbook-import.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<IWorkbookData>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('limits')), 12_000);
      worker.onmessage = (event: MessageEvent<{ workbook: IWorkbookData } | { error: string }>) => {
        clearTimeout(timer);
        if ('workbook' in event.data) resolve(event.data.workbook);
        else reject(new Error(event.data.error));
      };
      worker.onerror = () => { clearTimeout(timer); reject(new Error('unsupported')); };
      worker.postMessage({ bytes, fileName }, [bytes]);
    });
  } finally {
    worker.terminate();
  }
}
