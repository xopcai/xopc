import type { ModelSetupUse } from '@xopcai/gateway-contract';

export const capabilityGroups: { label: [string, string]; uses: ModelSetupUse[] }[] = [
  { label: ['文本', 'Text'], uses: ['chat'] },
  { label: ['图片', 'Images'], uses: ['vision', 'image'] },
  { label: ['语音', 'Voice'], uses: ['transcription', 'speech', 'conversation'] },
  { label: ['后台', 'Background'], uses: ['background'] },
];
export const capabilityLabels: Record<ModelSetupUse, [string, string]> = {
  chat: ['对话与任务', 'Chat and tasks'], vision: ['看图', 'Image understanding'],
  image: ['生成图片', 'Image generation'], transcription: ['录音与听写', 'Recording and dictation'],
  speech: ['文字转语音', 'Text to speech'], conversation: ['实时语音对话', 'Realtime conversation'],
  background: ['自动与后台任务', 'Background tasks'],
};
export function parseCapabilityUse(value: string | null): ModelSetupUse | undefined {
  return value && Object.hasOwn(capabilityLabels, value) ? value as ModelSetupUse : undefined;
}
export function capabilityReturnPath(value: string | null): string | undefined {
  return value && !/[\\\r\n]/.test(value) && (value.startsWith('/chat/') || value === '/personal' || value === '/settings/phone-use' || value.startsWith('/automations')) ? value : undefined;
}
export function modelCapabilityPath(use?: ModelSetupUse, services = false, returnTo?: string): string {
  const query = new URLSearchParams();
  if (use) query.set('configure', use);
  if (services) query.set('tab', 'services');
  const back = capabilityReturnPath(returnTo ?? null);
  if (back) query.set('returnTo', back);
  return `/settings/capabilities/models${query.size ? `?${query}` : ''}`;
}
export function withCapabilityReturnContext(path: string, context: URLSearchParams): string {
  const [pathname, search] = path.split('?');
  const query = new URLSearchParams(search);
  const back = capabilityReturnPath(context.get('returnTo'));
  if (back) query.set('returnTo', back);
  return `${pathname}${query.size ? `?${query}` : ''}`;
}
