// Export all agent tools
export { readFileTool } from './read.js';
export { writeFileTool } from './write.js';
export { editFileTool, type EditToolDetails } from './edit.js';
export { listDirTool } from './list-dir.js';
export { createShellTool } from './shell.js';

export { grepTool } from './grep.js';
export { findTool } from './find.js';

export { createWebSearchTool, webFetchTool } from './web.js';

export {
  createMessageTool,
  createSpawnTool,
  type SubagentResult,
} from './communication.js';

// New tools: grep and find
export {
  grepTool,
  createGrepTool,
  type GrepToolInput,
  type GrepToolDetails,
} from './grep.js';

export {
  findTool,
  createFindTool,
  type FindToolInput,
  type FindToolDetails,
} from './find.js';

// Utility exports
export {
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
  type TruncationResult,
  type TruncationOptions,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_BYTES,
  GREP_MAX_LINE_LENGTH,
} from './truncate.js';

export {
  normalizeToLF,
  restoreLineEndings,
  normalizeForFuzzyMatch,
  fuzzyFindText,
  stripBom,
  generateDiffString,
  type FuzzyMatchResult,
} from './edit-diff.js';
