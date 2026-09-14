/** Resolve at render time so a locale switch also updates cached models. */
export function modelDisplayName(model: { name: string; displayNames?: Partial<Record<'zh-CN' | 'en', string>> }, language: string): string {
  return model.displayNames?.[language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'] || model.name;
}
