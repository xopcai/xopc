/** Compatibility entry for the current conversation-only cloud Phone setup acceptance. */
if (process.env.XOPC_PHONE_SETUP_SOURCE === 'local') throw new Error('This conversation test uses the configured cloud test phone. Use verify-phone-use.mts for local emulator runtime acceptance.');
process.env.XOPC_SETUP_LIVE_SCENE ??= 'phone';
await import('./verify-conversational-setup-live.mts');
