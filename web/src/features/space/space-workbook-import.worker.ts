import { importWorkbook } from './space-workbook-format';

self.onmessage = (event: MessageEvent<{ bytes: ArrayBuffer; fileName: string }>) => {
  try {
    self.postMessage({ workbook: importWorkbook(event.data.bytes, event.data.fileName) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'unsupported' });
  }
};
