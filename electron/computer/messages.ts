import type { ElectronUiLanguage } from '../i18n.js';

const messages = {
  zh: {
    protocolIncompatible: '桌面端与网关版本不兼容。请将两者更新至同一版本并重新启动，无需重新授权或重新配置模型。',
    title: 'xopc 电脑操作', cancel: '取消', allow: '允许这一次',
    capabilityAccess: {
      title: '设备能力授权', allow: '允许',
      detail: '允许当前网关使用这项能力？',
      savedDetail: '允许当前网关使用这项能力？只需授权一次。',
    },
    reenroll: {
      message: '重新注册此桌面设备？', confirm: '重新注册设备',
      detail: '此设备身份已被撤销。重新注册将更换本机设备密钥，并恢复与网关的连接。\n\n此操作不会授予新的应用权限。',
    },
  },
  en: {
    protocolIncompatible: 'Desktop and Gateway versions are incompatible. Update both to the same version and restart. You don\'t need to re-authorize or reconfigure your models.',
    title: 'xopc Computer Use', cancel: 'Cancel', allow: 'Allow once',
    capabilityAccess: {
      title: 'Device capability access', allow: 'Allow',
      detail: 'Allow the current Gateway to use this capability?',
      savedDetail: 'Allow the current Gateway to use this capability? This permission will be saved.',
    },
    reenroll: {
      message: 'Re-register this desktop device?', confirm: 'Re-register device',
      detail: 'This device identity was revoked. Re-registering replaces the local device key and reconnects to the Gateway.\n\nThis does not grant new app permissions.',
    },
  },
};

export function getComputerMessages(language: ElectronUiLanguage) { return messages[language]; }
