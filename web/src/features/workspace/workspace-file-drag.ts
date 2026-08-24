export const WORKSPACE_FILE_DRAG_TYPE = 'application/x-xopc-workspace-file';

export type WorkspaceFileDragPayload = {
  path: string;
  name: string;
  sessionKey?: string;
  agentId?: string;
  projectId?: string;
};

export function writeWorkspaceFileDrag(
  dataTransfer: DataTransfer,
  payload: WorkspaceFileDragPayload,
): void {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(WORKSPACE_FILE_DRAG_TYPE, JSON.stringify(payload));
}

export function hasWorkspaceFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(WORKSPACE_FILE_DRAG_TYPE));
}

export function readWorkspaceFileDrag(
  dataTransfer: DataTransfer | null | undefined,
): WorkspaceFileDragPayload | null {
  if (!dataTransfer) return null;
  try {
    const value = JSON.parse(dataTransfer.getData(WORKSPACE_FILE_DRAG_TYPE)) as Partial<WorkspaceFileDragPayload>;
    const path = typeof value.path === 'string' ? value.path.trim() : '';
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!path || !name) return null;
    return {
      path,
      name,
      ...(typeof value.sessionKey === 'string' && value.sessionKey.trim()
        ? { sessionKey: value.sessionKey.trim() }
        : {}),
      ...(typeof value.agentId === 'string' && value.agentId.trim()
        ? { agentId: value.agentId.trim() }
        : {}),
      ...(typeof value.projectId === 'string' && value.projectId.trim()
        ? { projectId: value.projectId.trim() }
        : {}),
    };
  } catch {
    return null;
  }
}
