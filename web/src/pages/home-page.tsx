export function HomePage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <h1 className="text-lg font-semibold text-fg">控制台</h1>
      <p className="text-sm leading-relaxed text-fg-muted">
        React + Vite + Tailwind v4 网关前端占位页。后续在此接入会话、配置与日志等模块。
      </p>
    </div>
  );
}
