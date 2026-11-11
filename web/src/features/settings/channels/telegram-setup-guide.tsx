export function TelegramSetupGuide({ language }: { language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  return <section className="rounded-xl border border-edge bg-surface-panel p-4 text-sm" aria-label={zh ? 'Telegram 接入步骤' : 'Telegram setup steps'}>
    <h3 className="font-medium text-fg">{zh ? '连接 Telegram 机器人' : 'Connect a Telegram bot'}</h3>
    <ol className="mt-2 list-decimal space-y-2 pl-5 text-fg-muted">
      <li>{zh ? '在 Telegram 打开 ' : 'Open '}<a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent hover:underline">@BotFather</a>{zh ? '，发送 /newbot 创建机器人并获取 Bot Token。请勿把 Token 发给其他人。' : ' in Telegram. Send /newbot to create a bot and obtain its token. Keep the token private.'}</li>
      <li>{zh ? '在 xopc 粘贴 Bot Token，再扫码或点击链接打开机器人。' : 'Paste the bot token in xopc, then scan the QR code or open the link.'}</li>
      <li>{zh ? '在 Telegram 点击开始，收到回复后回到 xopc 确认本人。' : 'Tap Start in Telegram. After the bot replies, confirm your account in xopc.'}</li>
    </ol>
  </section>;
}
