import { describe, expect, it } from 'vitest';

import {
  getToolSummaryKind,
  isReadStyleTool,
  isSearchStyleTool,
} from '../tool-summary.js';

describe('tool summary classification', () => {
  it('classifies namespaced catalog tools in dot form', () => {
    expect(isReadStyleTool('filesystem.read_file')).toBe(true);
    expect(isSearchStyleTool('filesystem.file_search')).toBe(true);
    expect(getToolSummaryKind('runner.exec_command')).toBe('exec');
  });
});
