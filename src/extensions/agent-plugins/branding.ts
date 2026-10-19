import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { containedPath, type PluginManifest } from './validation.js';

/** Inline bounded package assets so authenticated and offline inventories need no extra fetch. */
export function pluginBranding(root: string, manifest: PluginManifest) {
  const extension = manifest.extensions?.['ai.xopc'] as { branding?: { icon?: unknown } } | undefined;
  const icon = extension?.branding?.icon;
  if (typeof icon !== 'string' || !icon || icon.includes('\0')) return undefined;
  try {
    const file = containedPath(root, resolve(root, icon));
    const info = statSync(file);
    if (!info.isFile() || info.size < 1 || info.size > 128 * 1024) return undefined;
    const type = extname(file).toLowerCase();
    const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }[type];
    if (!mime) return undefined;
    const bytes = readFileSync(file);
    if (type === '.svg') {
      const source = bytes.toString('utf8');
      if (!/<svg\b/i.test(source) || /<(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i.test(source)) return undefined;
    } else if (type === '.png' ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') return undefined;
    return { iconUrl: `data:${mime};base64,${bytes.toString('base64')}`, iconSha256: createHash('sha256').update(bytes).digest('hex') };
  } catch { return undefined; }
}
