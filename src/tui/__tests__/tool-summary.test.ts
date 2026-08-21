import { describe, expect, it } from 'vitest';

import {
  getToolSummaryKind,
  isReadStyleTool,
  isSearchStyleTool,
} from '../tool-summary.js';

describe('tool summary classification', () => {
  it('classifies namespaced catalog tools in dot form', () => {
    expect(isReadStyleTool('codebase-memory-mcp.get_code_snippet')).toBe(true);
    expect(isSearchStyleTool('codebase-memory-mcp.search_graph')).toBe(true);
    expect(getToolSummaryKind('codebase-memory-mcp.trace_path')).toBe('search');
  });
});
