import type { DiscussionAudioCaptureMode } from './audio-capture-mixer';

export const OPEN_DISCUSSION_CAPTURE_EVENT = 'open-discussion-capture';

export function openDiscussionCapture(
  projectId?: string,
  audioMode?: DiscussionAudioCaptureMode,
): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_DISCUSSION_CAPTURE_EVENT, {
      detail: {
        ...(projectId ? { projectId } : {}),
        ...(audioMode ? { audioMode } : {}),
      },
    }),
  );
}
