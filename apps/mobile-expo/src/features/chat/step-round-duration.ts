import type { Language } from '../../stores/preferences-store';

/** Compact human duration for the assistant steps summary (thinking + tools). */
export function formatStepRoundDuration(ms: number, language: Language): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return language === 'zh' ? '不到1秒' : '<1s';
  }
  const totalSec = Math.floor(ms / 1000);
  if (totalSec === 0) {
    return language === 'zh' ? '不到1秒' : '<1s';
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  if (language === 'zh') {
    if (min === 0) return `${sec}秒`;
    if (sec === 0) return `${min}分`;
    return `${min}分${sec}秒`;
  }

  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}
