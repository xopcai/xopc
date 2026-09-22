import type { ConfiguredModel } from '@/features/chat/api/registry-api';

export function buildPickerModels(
  models: ConfiguredModel[],
  capabilitiesFilter: 'vision' | 'computer-use' | undefined,
  valueTrimmed: string,
): ConfiguredModel[] {
  if (capabilitiesFilter === 'computer-use') return models.filter(m => Boolean(m.computerUse));
  const dedicatedComputer = (model: ConfiguredModel) => model.computerUse?.profile !== undefined
    && model.computerUse.profile !== 'openai-responses-computer-v1';
  if (capabilitiesFilter !== 'vision') return models.filter(m => !dedicatedComputer(m) || m.id === valueTrimmed);
  const visionOk = models.filter((m) => m.vision === true && !dedicatedComputer(m));
  if (!valueTrimmed) return visionOk;
  if (visionOk.some((m) => m.id === valueTrimmed)) return visionOk;
  const current = models.find((m) => m.id === valueTrimmed);
  if (current) return [current, ...visionOk];
  const slash = valueTrimmed.indexOf('/');
  const provider = slash >= 0 ? valueTrimmed.slice(0, slash) : '';
  const mid = slash >= 0 ? valueTrimmed.slice(slash + 1) : valueTrimmed;
  return [{ id: valueTrimmed, name: mid || valueTrimmed, provider: provider || '—', vision: false }, ...visionOk];
}
