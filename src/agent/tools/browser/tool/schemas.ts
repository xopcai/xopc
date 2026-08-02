/**
 * BrowserUseSchema — Typebox schema for the unified `browser_use` AgentTool.
 */

import { Type } from '@sinclair/typebox';

export const BrowserUseOptionsSchema = Type.Object({
  timeout: Type.Optional(Type.Number({ description: 'Action timeout override (ms).' })),
  headless: Type.Optional(Type.Boolean({ description: 'Override headless mode for this call.' })),
});

export const BrowserUseSchema = Type.Object({
  mode: Type.Union(
    [
      Type.Literal('command'),
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
  options: Type.Optional(BrowserUseOptionsSchema),
});
