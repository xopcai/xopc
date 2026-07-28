export type ResolvedEditorLink = {
  title: string;
  url: string;
};

export function sanitizeEditorLinkText(value: string): string {
  return value.replace(/[<>&]/g, '');
}

export function normalizeEditorLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^www\./i, 'www.')}`;
}

export function isLikelyEditorLinkUrl(value: string): boolean {
  return /^(https?:\/\/)\S+\.\S+$/i.test(value);
}

export function resolveEditorLink(
  title: string,
  url: string,
  selectedText = '',
): ResolvedEditorLink | null {
  const normalizedUrl = normalizeEditorLinkUrl(url);
  if (!normalizedUrl || !isLikelyEditorLinkUrl(normalizedUrl)) return null;
  const resolvedTitle = sanitizeEditorLinkText(
    title.trim() || selectedText.trim() || normalizedUrl,
  ).trim();
  if (!resolvedTitle) return null;
  return { title: resolvedTitle, url: normalizedUrl };
}
