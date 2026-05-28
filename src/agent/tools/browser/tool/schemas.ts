/**
 * BrowserUseSchema — Typebox schema for the unified `browser_use` AgentTool.
 */

import { Type } from '@sinclair/typebox';

export const BrowserUsePipelineSchema = Type.Object({
  yaml: Type.Optional(Type.String({ description: 'Inline YAML pipeline (brocli-style DSL).' })),
  script: Type.Optional(Type.String({ description: 'Alias for `yaml` — inline brocli YAML script.' })),
  path: Type.Optional(Type.String({ description: 'Path or http(s) URL to a .yaml pipeline file.' })),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Override pipeline arg defaults.' }),
  ),
  dryRun: Type.Optional(Type.Boolean({ description: 'Only parse & validate, do not execute.' })),
});

export const BrowserUseOptionsSchema = Type.Object({
  timeout: Type.Optional(Type.Number({ description: 'Action timeout override (ms).' })),
  headless: Type.Optional(Type.Boolean({ description: 'Override headless mode for this call.' })),
});

export const BrowserUseSchema = Type.Object({
  mode: Type.Union(
    [
      Type.Literal('command'),
      Type.Literal('pipeline'),
      Type.Literal('inspect'),
      Type.Literal('close'),
    ],
    { description: 'Execution mode.' },
  ),
  command: Type.Optional(
    Type.String({ description: 'Browser action name (command mode). E.g. open, click, type, screenshot.' }),
  ),
  args: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Action arguments (command mode).' }),
  ),
  pipeline: Type.Optional(BrowserUsePipelineSchema),
  options: Type.Optional(BrowserUseOptionsSchema),
});
