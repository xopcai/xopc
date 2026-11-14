import { fileIo as fs } from '@kit.CoreFileKit';
import { XopcMusicResume } from '../model/musicPlayback';

const RESUME_FILE = '/xopc-music-resume.json';

export function readMusicResume(filesDir: string): XopcMusicResume | undefined {
  try { return JSON.parse(fs.readTextSync(filesDir + RESUME_FILE)) as XopcMusicResume; }
  catch (_) { return undefined; }
}

export function writeMusicResume(filesDir: string, entry?: XopcMusicResume): void {
  const path = filesDir + RESUME_FILE;
  if (!entry) {
    if (fs.accessSync(path)) fs.unlinkSync(path);
    return;
  }
  const temporary = path + '.tmp';
  const file = fs.openSync(temporary, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
  try { fs.writeSync(file.fd, JSON.stringify(entry)); }
  finally { fs.closeSync(file); }
  fs.renameSync(temporary, path);
}
