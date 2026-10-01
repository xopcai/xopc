import type { ElectronUiLanguage } from '../i18n.js';

const messages = {
  zh: {
    protocolIncompatible: '桌面端与 Gateway 版本不兼容。请将两者更新至同一构建并重新启动；无需重新授权或重配模型。',
    title: 'xopc 电脑操作', cancel: '取消', allow: '允许这一次',
    reenroll: {
      message: '重新注册此桌面设备？', confirm: '重新注册设备',
      detail: '此设备身份已被撤销。重新注册将更新本机设备密钥，并恢复与网关的连接。\n\n此操作不会新增应用控制授权。',
    },
  },
  en: {
    protocolIncompatible: 'Desktop and Gateway protocols differ. Update both to the same build and restart. No permission or model changes are needed.',
    title: 'xopc Computer Use', cancel: 'Cancel', allow: 'Allow once',
    reenroll: {
      message: 'Re-register this desktop device?', confirm: 'Re-register device',
      detail: 'This device identity was revoked. Re-registering replaces the local device key and reconnects to the Gateway.\n\nThis does not grant new app permissions.',
    },
  },
};

export function getComputerMessages(language: ElectronUiLanguage) { return messages[language]; }
