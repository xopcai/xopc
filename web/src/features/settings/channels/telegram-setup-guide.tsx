export function TelegramSetupGuide({ language }: { language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  return <section className="rounded-xl border border-edge bg-surface-panel p-4 text-sm" aria-label={zh ? 'Telegram 接入步骤' : 'Telegram setup steps'}>
    <h3 className="font-medium text-fg">{zh ? '先连接机器人，再确认谁能访问' : 'Connect your bot, then choose who can access it'}</h3>
    <ol className="mt-2 list-decimal space-y-2 pl-5 text-fg-muted">
      <li>{zh ? '在 Telegram 打开 ' : 'Open '}<a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent hover:underline">@BotFather</a>{zh ? '，发送 /newbot 创建机器人并获取 Bot Token。请勿把 Token 发给其他人。' : ' in Telegram. Send /newbot to create a bot and obtain its token. Keep the token private.'}</li>
      <li>{zh ? '填写 Bot Token。首次接入建议使用 pairing（配对）；allowlist 只允许名单中的用户，open 允许所有人。群聊访问单独设置。' : 'Enter the bot token. Use pairing for first setup; allowlist admits listed users, while open admits everyone. Group access is configured separately.'}</li>
      <li>{zh ? '保存后检查上方连接状态；已保存不代表已经连通。' : 'Save, then check the connection status above. Saved settings do not prove a working connection.'}</li>
      <li>{zh ? '在 Telegram 给机器人发一条消息。若使用配对策略，按返回的配对提示批准自己的账号后再试。' : 'Message your bot in Telegram. With pairing enabled, follow the pairing instructions to approve your account, then try again.'}</li>
    </ol>
  </section>;
}
