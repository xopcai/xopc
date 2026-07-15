import { describe, expect, it } from 'vitest';

import {
  getToolSummaryKind,
  isReadStyleTool,
  isSearchStyleTool,
} from '../tool-summary.js';

describe('tool summary classification', () => {
  it('classifies codebase-memory MCP tools in dot and materialized forms', () => {
    expect(isReadStyleTool('codebase-memory-mcp.get_code_snippet')).toBe(true);
    expect(isReadStyleTool('codebase-memory-mcp__get_code_snippet')).toBe(true);
    expect(isSearchStyleTool('codebase-memory-mcp.search_graph')).toBe(true);
    expect(isSearchStyleTool('codebase-memory-mcp__query_graph')).toBe(true);
    expect(getToolSummaryKind('codebase-memory-mcp.trace_path')).toBe('search');
  });
});
