/**
 * GFM formatters for slash-command replies.
 *
 * Command output is rendered as Markdown on Web UI, TUI (gateway), and channels
 * (Telegram IR). Use blank-line-separated blocks and `-` lists — not single
 * newlines or unicode `•` bullets — so lists and headings parse correctly.
 */

/** Join non-empty blocks with a blank line (GFM paragraph separation). */
export function joinBlocks(...blocks: Array<string | undefined | null | false>): string {
  return blocks
    .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    .join('\n\n')
    .trimEnd();
}

/** Section heading (bold). */
export function section(title: string): string {
  return `**${title}**`;
}

/** Inline code span. */
export function code(text: string): string {
  return `\`${text}\``;
}

/** Italic hint / footnote. */
export function hint(text: string): string {
  return `_${text}_`;
}

export type BulletItem = string | { label: string; detail: string };

/** GFM bullet list (`-` prefix). */
export function bulletList(items: BulletItem[]): string {
  if (items.length === 0) return '';
  return items
    .map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      return `- **${item.label}** — ${item.detail}`;
    })
    .join('\n');
}

/** Settings-style key/value bullets. */
export function kvList(entries: Array<{ key: string; value: string }>): string {
  if (entries.length === 0) return '';
  return entries.map(({ key, value }) => `- **${key}**: ${value}`).join('\n');
}

/** Slash command reference line in a bullet list. */
export function commandBullet(name: string, description: string, aliases?: string[]): string {
  const aliasSuffix = aliases?.length ? ` (${aliases.join(', ')})` : '';
  return `- ${code(`/${name}${aliasSuffix}`)} — ${description}`;
}
