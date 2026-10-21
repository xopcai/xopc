import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { ComposerFrame } from '@/features/chat/composer/composer-frame';
import { ChannelsSettingsDialogFooter } from '@/features/settings/channels/channels-settings-dialog-footer';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import '@/styles/globals.css';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') ?? 'dawn';
const dark = params.get('mode') === 'dark';
document.documentElement.dataset.colorScheme = theme;
document.documentElement.classList.toggle('dark', dark);
useLocaleStore.setState({ language: 'zh' });

function SurfaceCase({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0">
    <h2 className="mb-2 text-sm font-semibold text-fg">{title}</h2>
    <div className="relative h-56 overflow-hidden rounded-xl border border-edge bg-surface-base">
      <div className="absolute inset-0 space-y-1 p-3 font-mono text-sm leading-6 text-fg" aria-hidden>
        {Array.from({ length: 10 }, (_, index) => <p key={index}>背景消息 {index + 1} — 此文字不应透入前景浮层</p>)}
      </div>
      {children}
    </div>
  </section>;
}

function Fixture() {
  return <main className="min-h-screen bg-surface-base p-5 sm:p-8">
    <div className="mx-auto max-w-6xl">
      <h1 className="text-lg font-semibold text-fg">浮层遮挡检查 · {theme} · {dark ? '深色' : '浅色'}</h1>
      <p className="mt-1 text-sm text-fg-muted">输入框顶部外侧透明；浮层内部、固定底栏及提示区域不透出背景文字。</p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <SurfaceCase title="聊天输入框（实际 ComposerFrame）">
          <div className="chat-composer-dock pointer-events-none absolute inset-x-0 bottom-0 z-10 [--chat-composer-bottom-radius:1rem] [--chat-composer-bottom-space:1rem]">
            <div className="relative px-4 pt-4 pb-[var(--chat-composer-bottom-space)]">
              <ComposerFrame className="pointer-events-auto p-4">
                <p className="min-h-16 text-sm text-fg-muted">提问或描述任务…</p>
                <div className="flex justify-between text-xs text-fg-muted"><span>＋</span><span>选择模型　↑</span></div>
              </ComposerFrame>
            </div>
          </div>
        </SurfaceCase>
        <SurfaceCase title="设置固定底栏（实际渠道设置组件）">
          <div className="absolute inset-x-4 bottom-4 overflow-hidden rounded-xl border border-edge">
            <ChannelsSettingsDialogFooter ch={messages('zh').channelsSettings} dirty saving={false} onCancel={() => {}} onDiscard={() => {}} onSave={() => {}} />
          </div>
        </SurfaceCase>
        <SurfaceCase title="气泡 / 工具条 / 浮窗共用的不透明浮层色">
          <div data-opacity-case="overlay" className="absolute inset-x-4 bottom-4 rounded-xl border border-edge bg-surface-overlay p-4 text-sm text-fg shadow-popover">
            <h3 className="font-medium">连接设置与工具提示</h3>
            <p className="mt-2 leading-6 text-fg-muted">背景内容不会与这段文字重叠，状态与操作始终清晰。</p>
            <p className="mt-3 text-xs text-accent-fg">继续配置　　查看详情</p>
          </div>
        </SurfaceCase>
        <SurfaceCase title="桌面助手任务提示（实际队列表面样式）">
          <div className="desktop-pet-queue absolute inset-x-4 bottom-4 text-sm text-fg">
            <div className="p-3"><strong>任务已完成</strong><p className="mt-2 text-fg-muted">结果已保存，可以继续查看或处理。</p></div>
          </div>
        </SurfaceCase>
      </div>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
