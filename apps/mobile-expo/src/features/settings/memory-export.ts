import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { apiFetch, formatApiHttpError } from '../../api/client';

export async function shareUserMemoryExport(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('System sharing is unavailable');
  const response = await apiFetch('/api/user-model/export');
  if (!response.ok) throw new Error(formatApiHttpError(response.status, response.statusText));
  const directory = new Directory(Paths.cache, 'memory-export', `${Date.now()}`);
  directory.create({ intermediates: true });
  try {
    const filename = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
      ?? 'xopc-memory.json';
    const file = new File(directory, filename);
    file.create();
    file.write(await response.text());
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export xopc memory' });
  } finally {
    try { directory.delete(); } catch { /* Sharing has already completed. */ }
  }
}
