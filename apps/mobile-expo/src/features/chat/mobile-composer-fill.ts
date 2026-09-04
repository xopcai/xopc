import { DeviceEventEmitter } from 'react-native';

export const MOBILE_COMPOSER_FILL_EVENT = 'xopc:fill-chat-composer';
export const MOBILE_COMPOSER_APPEND_EVENT = 'xopc:append-chat-composer';

export function dispatchMobileComposerFill(text: string): void {
  DeviceEventEmitter.emit(MOBILE_COMPOSER_FILL_EVENT, text);
}

export function dispatchMobileComposerAppend(text: string): void {
  DeviceEventEmitter.emit(MOBILE_COMPOSER_APPEND_EVENT, text);
}
