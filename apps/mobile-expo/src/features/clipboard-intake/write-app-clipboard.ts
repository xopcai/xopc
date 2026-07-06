import * as Clipboard from 'expo-clipboard';

import { rememberAppClipboardText } from './app-clipboard-origin';

export async function setAppClipboardStringAsync(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  rememberAppClipboardText(text);
}

