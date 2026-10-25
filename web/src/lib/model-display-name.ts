/** Resolve at render time so a locale switch also updates cached models. */
export function modelDisplayName(model: { id?: string; name: string; displayNames?: Partial<Record<'zh-CN' | 'en', string>> }, language: string): string {
  return model.displayNames?.[language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'] || (language.toLowerCase().startsWith('zh') && model.id === 'xopc-cloud/auto' && model.name === 'Standard' ? '标准' : language.toLowerCase().startsWith('zh') && model.id === 'xopc-cloud/advanced' && model.name === 'Advanced' ? '高级' : model.name);
}
