/**
 * Telegram Inline Keyboards
 */

import { InlineKeyboard } from 'grammy';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
}

export class TelegramInlineKeyboards {
  static modelSelector(models: ModelInfo[], currentModel?: string): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    
    for (const model of models) {
      const isCurrent = model.id === currentModel;
      const label = isCurrent ? `✅ ${model.name}` : model.name;
      keyboard.text(label, `model:${model.id}`).row();
    }

    keyboard.text('❌ Cancel', 'cancel');
    return keyboard;
  }

  static providerSelector(providers: ProviderInfo[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    
    for (const provider of providers) {
      keyboard.text(provider.name, `provider:${provider.id}`).row();
    }

    keyboard.text('❌ Cancel', 'cancel');
    return keyboard;
  }

  static cleanupConfirm(): InlineKeyboard {
    return new InlineKeyboard()
      .text('🗑️ Archive sessions older than 30 days', 'cleanup:confirm').row()
      .text('❌ Cancel', 'cancel');
  }

  static back(): InlineKeyboard {
    return new InlineKeyboard().text('⬅️ Back', 'providers').row().text('❌ Cancel', 'cancel');
  }

  static confirm(confirmLabel: string = '✅ Confirm', confirmData: string = 'confirm'): InlineKeyboard {
    return new InlineKeyboard()
      .text(confirmLabel, confirmData).row()
      .text('❌ Cancel', 'cancel');
  }
}
