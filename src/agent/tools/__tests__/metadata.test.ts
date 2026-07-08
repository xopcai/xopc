import { describe, expect, it } from 'vitest';

import { createApplyPatchTool } from '../apply-patch.js';
import { createExecCommandTool } from '../exec-command.js';
import { createReadFileTool } from '../read.js';
import { createWriteFileTool } from '../write.js';
import { getToolMetadata } from '../metadata.js';

describe('tool metadata', () => {
  it('marks read-only tools as parallel and idempotent', () => {
    expect(getToolMetadata(createReadFileTool('/tmp'))).toMatchObject({
      mutatesWorkspace: false,
      mutationScope: 'none',
      supportsParallel: true,
      idempotent: true,
      finalGuardRelevant: false,
    });
  });

  it('marks workspace write tools as exclusive final-guard inputs', () => {
    expect(getToolMetadata(createApplyPatchTool('/tmp'))).toMatchObject({
      mutatesWorkspace: true,
      mutationScope: 'workspace',
      supportsParallel: false,
      idempotent: false,
      requiresExclusiveWorkspaceLock: true,
      finalGuardRelevant: true,
    });
    expect(getToolMetadata(createWriteFileTool('/tmp'))).toMatchObject({
      mutatesWorkspace: true,
      mutationScope: 'workspace',
      requiresExclusiveWorkspaceLock: true,
      finalGuardRelevant: true,
    });
  });

  it('marks exec_command as final-guard relevant with unknown mutation scope', () => {
    expect(getToolMetadata(createExecCommandTool('/tmp'))).toMatchObject({
      mutatesWorkspace: false,
      mutationScope: 'unknown',
      supportsParallel: false,
      idempotent: false,
      finalGuardRelevant: true,
    });
  });
});
