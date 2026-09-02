import { showComposerNotification } from '@/features/chat/composer/composer-notifications';

type FileShellActionResult =
  | { ok: boolean; error?: string; code?: string }
  | { success: boolean; error?: string }
  | undefined;

/** Run one trusted desktop file action and surface failures instead of silently swallowing them. */
export async function runFileShellAction(
  action: () => Promise<FileShellActionResult> | undefined,
  fallbackMessage: string,
): Promise<boolean> {
  try {
    const result = await action();
    if (result && 'ok' in result && result.code === 'CANCELED') return false;
    const succeeded = result && ('ok' in result ? result.ok : result.success);
    if (succeeded) return true;
    showComposerNotification('warning', result?.error || fallbackMessage, undefined, { duration: 4000 });
    return false;
  } catch {
    showComposerNotification('warning', fallbackMessage, undefined, { duration: 4000 });
    return false;
  }
}
