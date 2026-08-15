export const OPEN_DISCUSSION_CAPTURE_EVENT = 'open-discussion-capture';

export function openDiscussionCapture(projectId?: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_DISCUSSION_CAPTURE_EVENT, {
    detail: projectId ? { projectId } : {},
  }));
}

