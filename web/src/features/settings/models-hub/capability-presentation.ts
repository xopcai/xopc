import type { ModelSetupUse } from '@xopcai/gateway-contract';

export const capabilityDescriptions: Record<ModelSetupUse, [string, string]> = {
  chat: ['日常对话与交办任务', 'Everyday conversations and tasks'],
  vision: ['理解照片、截图和图片内容', 'Understand photos, screenshots and images'],
  image: ['根据描述生成图片', 'Create images from a description'],
  transcription: ['聊天听写与笔记录音转文字', 'Dictate messages and transcribe recorded notes'],
  speech: ['朗读消息，选择喜欢的音色', 'Read messages aloud in your preferred voice'],
  conversation: ['实时通话、音色与音频设备', 'Live calls, voices and audio devices'],
  background: ['自动化、定时和无人值守任务', 'Automations, schedules and unattended tasks'],
};

export function serviceDisplayName(id: string, fallback: string, zh: boolean): string {
  if (!zh) return fallback;
  const names: Record<string, string> = {
    'qwen-token-plan-cn': '阿里云百炼订阅 · 北京',
    'qwen-token-plan': '阿里云百炼订阅 · 国际',
    'dashscope-cn': '阿里云百炼 · 中国区',
    'dashscope-intl': '阿里云百炼 · 国际区',
    'xiaomi-token-plan-cn': '小米 MiMo 订阅 · 中国区',
  };
  return names[id] ?? fallback;
}
