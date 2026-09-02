import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

export const USER_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const USER_AVATAR_DIR = 'profile';
const USER_AVATAR_BASENAME = 'user-avatar';
const USER_AVATAR_EXTENSIONS = ['.png', '.jpg', '.webp'] as const;

type UserAvatarMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type UserAvatarResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: 400 | 404 };

function avatarRoot(): string {
  return join(resolveStateDir(), USER_AVATAR_DIR);
}

function avatarFilenames(): string[] {
  return USER_AVATAR_EXTENSIONS.map((extension) => `${USER_AVATAR_BASENAME}${extension}`);
}

function mimeToExtension(mimeType: string): '.png' | '.jpg' | '.webp' | null {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  if (normalized === 'image/webp') return '.webp';
  return null;
}

function extensionToMime(extension: '.png' | '.jpg' | '.webp'): UserAvatarMime {
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function detectImageMime(buffer: Uint8Array): UserAvatarMime | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export async function readUserAvatar(): Promise<UserAvatarResult<{
  buffer: Buffer;
  contentType: UserAvatarMime;
}>> {
  const root = avatarRoot();
  for (const filename of avatarFilenames()) {
    const path = join(root, filename);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > USER_AVATAR_MAX_BYTES) continue;
      const buffer = await readFile(path);
      const contentType = detectImageMime(buffer);
      if (!contentType) continue;
      return { ok: true, data: { buffer, contentType } };
    } catch {
      /* Try the next supported extension. */
    }
  }
  return { ok: false, error: 'avatar not found', status: 404 };
}

export async function writeUserAvatar(
  base64: string,
  mimeType: string,
): Promise<UserAvatarResult<{}>> {
  const extension = mimeToExtension(mimeType);
  if (!extension) {
    return { ok: false, error: 'unsupported mimeType (use image/png, image/jpeg, or image/webp)', status: 400 };
  }
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return { ok: false, error: 'invalid base64', status: 400 };
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > USER_AVATAR_MAX_BYTES) {
    return { ok: false, error: `avatar must be non-empty and at most ${USER_AVATAR_MAX_BYTES} bytes`, status: 400 };
  }
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || detectedMime !== extensionToMime(extension)) {
    return { ok: false, error: 'file content does not match declared image type', status: 400 };
  }

  const root = avatarRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const targetFilename = `${USER_AVATAR_BASENAME}${extension}`;
  for (const filename of avatarFilenames()) {
    if (filename === targetFilename) continue;
    try {
      await unlink(join(root, filename));
    } catch {
      /* Absent. */
    }
  }
  await writeFile(join(root, targetFilename), buffer, { mode: 0o600 });
  return { ok: true, data: {} };
}

export async function deleteUserAvatar(): Promise<UserAvatarResult<{}>> {
  const root = avatarRoot();
  for (const filename of avatarFilenames()) {
    try {
      await unlink(join(root, filename));
    } catch {
      /* Idempotent when no avatar exists. */
    }
  }
  return { ok: true, data: {} };
}
