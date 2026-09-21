import type { ComputerAction } from '@xopcai/computer-control-contract';
import type { ComputerApproval } from '../../src/computer/broker.js';
import type { ElectronUiLanguage } from '../i18n.js';

const messages = {
  zh: {
    protocolIncompatible: '桌面端与 Gateway 版本不兼容。请将两者更新至同一构建并重新启动；无需重新授权或重配模型。',
    title: 'xopc 电脑操作', cancel: '取消', allow: '允许这一次',
    reenroll: {
      message: '重新注册此桌面设备？', confirm: '重新注册设备',
      detail: '此设备身份已被撤销。重新注册将更新本机设备密钥，并恢复与网关的连接。\n\n此操作不会新增应用控制授权。',
    },
    sessionTitle: '允许此任务观察和操作这个应用？', actionTitle: '允许这一步操作？',
    observeTitle: '允许此任务查看这个应用？', prepare: '任务可以启动应用或恢复目标窗口，但不会因此获得操作内容的权限。',
    app: '应用', model: '模型', recipient: '截图接收方', upstream: '上游模型服务', action: '操作',
    sessionPrivacy: '窗口截图和文字会经当前网关发送至上述服务，可能包含敏感信息。',
    sessionDuration: '本次授权最长有效 15 分钟。可随时在设置或托盘中停止；隐藏窗口或锁屏也会停止。',
    actionWarning: '仅允许这一步。涉及支付、密码、验证码或安全设置时，请取消并手动处理。',
    actions: { click: '点击', doubleClick: '双击', left: '左键', right: '右键', typeText: '输入文字',
      setValue: '填写字段', pressKeys: '按键', scroll: '滚动', wait: '等待', focused: '当前输入框',
      at: '位置', text: '文字', horizontal: '水平', vertical: '垂直', milliseconds: '毫秒' },
  },
  en: {
    protocolIncompatible: 'Desktop and Gateway protocols differ. Update both to the same build and restart. No permission or model changes are needed.',
    title: 'xopc Computer Use', cancel: 'Cancel', allow: 'Allow once',
    reenroll: {
      message: 'Re-register this desktop device?', confirm: 'Re-register device',
      detail: 'This device identity was revoked. Re-registering replaces the local device key and reconnects to the Gateway.\n\nThis does not grant new app permissions.',
    },
    sessionTitle: 'Allow this task to observe and control this app?', actionTitle: 'Allow this action?',
    observeTitle: 'Allow this task to view this app?', prepare: 'The task may launch the app or restore the target window. This does not grant permission to modify its contents.',
    app: 'App', model: 'Model', recipient: 'Screenshot recipient', upstream: 'Upstream model service', action: 'Action',
    sessionPrivacy: 'Window screenshots and text pass through the current Gateway to these services and may contain sensitive information.',
    sessionDuration: 'This permission lasts up to 15 minutes. Stop from settings or the tray at any time. Hiding the window or locking the screen also stops control.',
    actionWarning: 'Allow this action only. For payments, passwords, verification codes or security settings, cancel and handle them manually.',
    actions: { click: 'Click', doubleClick: 'Double-click', left: 'left button', right: 'right button', typeText: 'Type text',
      setValue: 'Fill field', pressKeys: 'Press keys', scroll: 'Scroll', wait: 'Wait', focused: 'focused input',
      at: 'Position', text: 'Text', horizontal: 'horizontal', vertical: 'vertical', milliseconds: 'ms' },
  },
};

export function getComputerMessages(language: ElectronUiLanguage) { return messages[language]; }

export function describeComputerAction(language: ElectronUiLanguage, action: ComputerAction): string {
  const t = getComputerMessages(language).actions;
  const point = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`;
  switch (action.kind) {
    case 'click': return `${action.count === 2 ? t.doubleClick : t.click} · ${t[action.button]} · ${point(action.point)}`;
    case 'typeText': return `${t.typeText} · ${action.point ? point(action.point) : t.focused}\n${t.text}: ${JSON.stringify(action.text)}`;
    case 'setValue': return `${t.setValue} · ${action.ref}\n${t.text}: ${JSON.stringify(action.text)}`;
    case 'pressKeys': return `${t.pressKeys} · ${action.keys.join(' + ')}`;
    case 'scroll': return `${t.scroll} · ${t.at}: ${point(action.point)} · ${t.horizontal}: ${action.deltaX} · ${t.vertical}: ${action.deltaY}`;
    case 'wait': return `${t.wait} · ${action.durationMs} ${t.milliseconds}`;
  }
}

export function computerApprovalCopy(language: ElectronUiLanguage, request: ComputerApproval) {
  const t = getComputerMessages(language);
  return request.kind === 'session' ? {
    message: request.mode === 'observe' ? t.observeTitle : t.sessionTitle,
    detail: [`${t.app}: ${request.appName}`, `${t.model}: ${request.model.modelRef}`, `${t.recipient}: ${request.model.origin}`,
      ...(request.model.upstreamOrigin ? [`${t.upstream}: ${request.model.upstreamOrigin}`] : []),
      ...(request.prepare ? ['', t.prepare] : []), '', t.sessionPrivacy, '', t.sessionDuration].join('\n'),
  } : {
    message: t.actionTitle,
    detail: `${t.app}: ${request.target.appId}\n${t.action}: ${describeComputerAction(language, request.action)}\n\n${t.actionWarning}`,
  };
}
