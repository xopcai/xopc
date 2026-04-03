import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { getExtensionFromMime } from "./mime.js";

/**
 * Parse `data:mime;base64,...` into buffer (aligned with Telegram `parseDataUrl`).
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  if (!dataUrl.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const header = dataUrl.slice(0, comma);
  const mimeMatch = header.match(/^data:([^;]+)/);
  if (!mimeMatch) return null;
  if (!header.toLowerCase().includes(";base64")) return null;
  const b64 = dataUrl.slice(comma + 1).replace(/\s/g, "");
  return {
    mimeType: mimeMatch[1].trim(),
    buffer: Buffer.from(b64, "base64"),
  };
}

export async function writeDataUrlBufferToTemp(params: {
  buffer: Buffer;
  mimeType: string;
  destDir: string;
}): Promise<string> {
  await fs.mkdir(params.destDir, { recursive: true });
  const ext = getExtensionFromMime(params.mimeType);
  const name = `weixin-data-${randomBytes(8).toString("hex")}${ext}`;
  const filePath = path.join(params.destDir, name);
  await fs.writeFile(filePath, params.buffer);
  return filePath;
}
