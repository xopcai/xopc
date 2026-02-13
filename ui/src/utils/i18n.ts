export type TranslationKey = 
  | 'Type a message...'
  | 'Attach file'
  | 'Send message'
  | 'Abort'
  | 'No session available'
  | 'No agent set'
  | 'Configuration'
  | 'Cancel'
  | 'Save'
  | 'No result'
  | 'Artifacts'
  | 'Show artifacts';

const translations: Record<string, Partial<Record<TranslationKey, string>>> = {
  en: {
    'Type a message...': 'Type a message...',
    'Attach file': 'Attach file',
    'Send message': 'Send message',
    'Abort': 'Abort',
    'No session available': 'No session available',
    'No agent set': 'No agent set',
    'Configuration': 'Configuration',
    'Cancel': 'Cancel',
    'Save': 'Save',
    'No result': 'No result',
    'Artifacts': 'Artifacts',
    'Show artifacts': 'Show artifacts',
  },
  zh: {
    'Type a message...': '输入消息...',
    'Attach file': '附加文件',
    'Send message': '发送消息',
    'Abort': '中止',
    'No session available': '无可用会话',
    'No agent set': '未设置代理',
    'Configuration': '配置',
    'Cancel': '取消',
    'Save': '保存',
    'No result': '无结果',
    'Artifacts': '产物',
    'Show artifacts': '显示产物',
  },
};

let currentLanguage = 'en';

export function i18n(key: TranslationKey): string {
  return translations[currentLanguage]?.[key] || translations.en[key] || key;
}

export function setLanguage(lang: string): void {
  currentLanguage = lang;
}

export { translations };
