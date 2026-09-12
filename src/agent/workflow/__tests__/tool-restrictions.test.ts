import { describe, expect, it } from 'vitest';

import { resolveAllowedToolNames } from '../subagent-runner.js';
import { STRUCTURED_OUTPUT_TOOL_NAME } from '../structured-output-tool.js';

describe('workflow tool restrictions', () => {
  it('preserves an explicit empty toolset instead of granting the default tools', () => {
    expect(resolveAllowedToolNames([], false)).toEqual([]);
    expect(resolveAllowedToolNames([], true)).toEqual([STRUCTURED_OUTPUT_TOOL_NAME]);
    expect(resolveAllowedToolNames(undefined, false).length).toBeGreaterThan(0);
  });
});
