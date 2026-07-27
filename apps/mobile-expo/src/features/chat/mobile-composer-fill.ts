import { DeviceEventEmitter } from 'react-native';

export const MOBILE_COMPOSER_FILL_EVENT = 'xopc:fill-chat-composer';

export function dispatchMobileComposerFill(text: string): void {
  DeviceEventEmitter.emit(MOBILE_COMPOSER_FILL_EVENT, text);
}
