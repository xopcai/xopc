import type { StoredLanguage } from '@/lib/storage';

/** Compact elapsed time for the execution progress line (e.g. `12s`, `1分05秒`). */
export function formatExecutionElapsedMs(ms: number, language: StoredLanguage): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) {
    return language === 'zh' ? `${sec}秒` : `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) {
    return language === 'zh' ? `${m}分${String(s).padStart(2, '0')}秒` : `${m}m ${s}s`;
  }
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return language === 'zh' ? `${h}小时${rm}分` : `${h}h ${rm}m`;
}
