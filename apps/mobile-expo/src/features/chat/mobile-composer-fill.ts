import { DeviceEventEmitter } from 'react-native';

export const MOBILE_COMPOSER_FILL_EVENT = 'xopc:fill-chat-composer';
export const MOBILE_COMPOSER_APPEND_EVENT = 'xopc:append-chat-composer';

export function dispatchMobileComposerFill(conversationId: string, text: string): void {
  DeviceEventEmitter.emit(MOBILE_COMPOSER_FILL_EVENT, { conversationId, text });
}

export function dispatchMobileComposerAppend(conversationId: string, text: string): void {
  DeviceEventEmitter.emit(MOBILE_COMPOSER_APPEND_EVENT, { conversationId, text });
}
