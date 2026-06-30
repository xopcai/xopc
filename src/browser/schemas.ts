import { Type } from '@sinclair/typebox';

export const BrowserNavigateSchema = Type.Object({
  url: Type.String({ description: 'URL to navigate to' }),
  waitFor: Type.Optional(
    Type.Union(
      [Type.Literal('load'), Type.Literal('domcontentloaded'), Type.Literal('networkidle')],
      {
        description: 'Wait condition (default: domcontentloaded)',
      },
    ),
  ),
});

export const BrowserSnapshotSchema = Type.Object({
  selector: Type.Optional(
    Type.String({ description: 'CSS selector to snapshot a specific element. Omit for full page.' }),
  ),
  maxLength: Type.Optional(
    Type.Number({ description: 'Max characters in snapshot (default: 30000)', default: 30000 }),
  ),
});

export const BrowserClickSchema = Type.Object({
  selector: Type.Optional(Type.String({ description: 'CSS selector of the element to click' })),
  text: Type.Optional(
    Type.String({ description: 'Visible text of the element to click (uses getByText)' }),
  ),
  role: Type.Optional(
    Type.String({
      description: 'ARIA role and accessible name, e.g. "button:Submit" (uses getByRole)',
    }),
  ),
});

export const BrowserTypeSchema = Type.Object({
  selector: Type.Optional(Type.String({ description: 'CSS selector of the input field' })),
  label: Type.Optional(Type.String({ description: 'Label text of the input field (uses getByLabel)' })),
  text: Type.String({ description: 'Text to type into the field' }),
  pressEnter: Type.Optional(
    Type.Boolean({ description: 'Press Enter after typing (default: false)' }),
  ),
});

export const BrowserScrollSchema = Type.Object({
  direction: Type.Union([Type.Literal('down'), Type.Literal('up')], {
    description: 'Scroll direction',
  }),
  amount: Type.Optional(
    Type.Number({ description: 'Pixels to scroll (default: 500)', default: 500 }),
  ),
});

export const BrowserScreenshotSchema = Type.Object({
  selector: Type.Optional(
    Type.String({ description: 'CSS selector to screenshot a specific element. Omit for full page.' }),
  ),
  description: Type.Optional(
    Type.String({ description: 'What to look for in the screenshot (passed to the vision model)' }),
  ),
});

export const BrowserBackSchema = Type.Object({
  waitFor: Type.Optional(
    Type.Union(
      [Type.Literal('load'), Type.Literal('domcontentloaded'), Type.Literal('networkidle')],
      { description: 'Wait condition after going back (default: domcontentloaded)' },
    ),
  ),
});

export const BrowserPressSchema = Type.Object({
  key: Type.String({
    description:
      'Key or key combination to press, e.g. "Enter", "Tab", "Escape", "ArrowDown", "Control+A", "Shift+Enter"',
  }),
});

export const BrowserConsoleSchema = Type.Object({
  javascript: Type.Optional(
    Type.String({
      description:
        'JavaScript expression to evaluate in the page context. The return value is serialized to JSON.',
    }),
  ),
});

export const BrowserGetImagesSchema = Type.Object({
  selector: Type.Optional(
    Type.String({ description: 'CSS selector to limit image extraction scope. Omit for full page.' }),
  ),
  maxImages: Type.Optional(
    Type.Number({ description: 'Max images to return (default: 20)', default: 20 }),
  ),
});

export const BrowserCloseSchema = Type.Object({});

export const BrowserVisionSchema = Type.Object({
  prompt: Type.Optional(
    Type.String({
      description:
        'What to analyze in the screenshot (default: describe the visible UI state). Requires an available image model.',
    }),
  ),
  selector: Type.Optional(
    Type.String({ description: 'CSS selector to screenshot a specific element. Omit for full page.' }),
  ),
});

export const BrowserDialogSchema = Type.Object({
  action: Type.Union([Type.Literal('accept'), Type.Literal('dismiss')], {
    description: 'Whether to accept or dismiss the dialog',
  }),
  promptText: Type.Optional(
    Type.String({ description: 'Text to enter into a prompt() dialog before accepting' }),
  ),
});

export const BrowserCdpSchema = Type.Object({
  method: Type.String({
    description: 'CDP method name, e.g. "Runtime.evaluate", "Page.captureScreenshot"',
  }),
  params: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'CDP method parameters as a JSON object',
    }),
  ),
});
