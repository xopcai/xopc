import { describe, expect, it } from 'vitest';

import {
  hasWorkspaceFileDrag,
  readWorkspaceFileDrag,
  WORKSPACE_FILE_DRAG_TYPE,
  writeWorkspaceFileDrag,
} from '@/features/workspace/workspace-file-drag';

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: 'uninitialized',
    get types() {
      return Array.from(data.keys());
    },
    getData: (type: string) => data.get(type) ?? '',
    setData: (type: string, value: string) => {
      data.set(type, value);
    },
  } as unknown as DataTransfer;
}

describe('workspace file drag payload', () => {
  it('round-trips a session-scoped workspace file', () => {
    const transfer = createDataTransfer();

    writeWorkspaceFileDrag(transfer, {
      path: 'reports/status.pdf',
      name: 'status.pdf',
      sessionKey: 'agent:task:123',
    });

    expect(transfer.effectAllowed).toBe('copy');
    expect(hasWorkspaceFileDrag(transfer)).toBe(true);
    expect(readWorkspaceFileDrag(transfer)).toEqual({
      path: 'reports/status.pdf',
      name: 'status.pdf',
      sessionKey: 'agent:task:123',
    });
  });

  it('rejects malformed or incomplete payloads', () => {
    const transfer = createDataTransfer();
    transfer.setData(WORKSPACE_FILE_DRAG_TYPE, '{bad json');
    expect(readWorkspaceFileDrag(transfer)).toBeNull();

    transfer.setData(WORKSPACE_FILE_DRAG_TYPE, JSON.stringify({ path: 'file.txt' }));
    expect(readWorkspaceFileDrag(transfer)).toBeNull();
  });
});
