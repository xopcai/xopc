// Apply the saved appearance before paint; storage can be unavailable in private contexts.
(() => {
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const theme = read('xopc.evals.theme');
  const mode = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  const locale = read('xopc.evals.locale');
  document.documentElement.dataset.theme = mode;
  document.documentElement.classList.toggle('dark', mode === 'dark' || mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.lang = locale === 'en' || !locale && !navigator.language.startsWith('zh') ? 'en' : 'zh-CN';
})();
