#!/usr/bin/env node
/**
 * CLI entry: log-level preset must run before any module that initializes the logger.
 * (Bundlers may reorder imports in `index.ts`; this file stays dependency-minimal.)
 */
import './cli-log-level-preset.js';
import './index.js';
