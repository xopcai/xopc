import { useState } from 'react';
import { creditDecimal, parseCreditDecimal } from '@xopcai/gateway-contract';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { SettingsAdvancedSection } from '@/features/settings/settings-advanced-section';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import type { AgentDefaults } from '@/features/settings/types/agent-gateway';

const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

function positiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function CreditRunLimit({ draft, setDraft, zh }: { draft: AgentDefaults; setDraft: (draft: AgentDefaults) => void; zh: boolean }) {
  const [value, setValue] = useState(() => draft.runtime.cloudCreditLimitPerRunMicro
    ? creditDecimal(draft.runtime.cloudCreditLimitPerRunMicro) : '');
  const [invalid, setInvalid] = useState(false);
  return <label className="block text-xs font-medium text-fg-muted">
    {zh ? '每次运行的 Cloud 消费上限（Credits）' : 'Cloud spend limit per run (Credits)'}
    <input type="text" inputMode="decimal" value={value} aria-invalid={invalid}
      placeholder={zh ? '不设置额外上限' : 'No additional limit'} className={`${inputClass} mt-2`}
      onChange={event => {
        const next = event.target.value;
        setValue(next);
        try {
          const micro = next === '' ? undefined : parseCreditDecimal(next);
          if (micro === '0' || (micro && micro.length > 15)) throw new Error('Invalid limit');
          setInvalid(false);
          setDraft({ ...draft, runtime: { ...draft.runtime, cloudCreditLimitPerRunMicro: micro } });
        } catch { setInvalid(true); }
      }}
      onBlur={() => {
        if (invalid) setValue(draft.runtime.cloudCreditLimitPerRunMicro ? creditDecimal(draft.runtime.cloudCreditLimitPerRunMicro) : '');
        setInvalid(false);
      }} />
    <span className={`mt-2 block font-normal ${invalid ? 'text-danger' : 'text-fg-subtle'}`}>
      {invalid
        ? (zh ? '请输入大于零、最多四位小数的 Credits。无效输入不会保存。' : 'Enter positive Credits with up to four decimals. Invalid input is not saved.')
        : (zh ? '模型、图片和文件语音调用共享上限；不支持实时语音或 Cloud 电脑控制，不包含运行前后的后台调用。达到上限后停止，调整后需手动继续。' : 'Shared by model, image and file audio calls during a run. Does not support realtime voice or Cloud computer use; excludes background calls outside the run. Stops at the limit; continue manually after adjusting it.')}
    </span>
  </label>;
}

export function AgentDefaultsRuntimePanel({
  draft,
  setDraft,
  zh,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  zh: boolean;
}) {

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-surface-hover/20 p-5"><h2 className="mb-4 text-base font-semibold text-fg">{zh ? "费用控制" : "Spending control"}</h2><CreditRunLimit draft={draft} setDraft={setDraft} zh={zh} /></section>
      <SettingsAdvancedSection title={zh ? "执行与缓存策略" : "Execution and cache policy"} summary={zh ? `轮数：${draft.runtime.maxTurns ?? "默认"} · 超时：${draft.runtime.timeoutMs ?? "默认"} · 缓存：${draft.runtime.promptCache?.mode ?? "默认"} · Codemode：${draft.runtime.codemode?.enabled ? "开启" : "关闭"}` : `Turns: ${draft.runtime.maxTurns ?? "default"} · Timeout: ${draft.runtime.timeoutMs ?? "default"} · Cache: ${draft.runtime.promptCache?.mode ?? "default"} · Codemode: ${draft.runtime.codemode?.enabled ? "on" : "off"}`}>
        <section className="rounded-xl bg-surface-hover/20 p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={draft.runtime.codemode?.enabled ?? false}
              onChange={event => setDraft({ ...draft, runtime: { ...draft.runtime,
                codemode: { ...draft.runtime.codemode, enabled: event.target.checked } } })}
              className="mt-1 size-4 accent-[var(--color-accent)]" />
            <span><span className="block text-base font-semibold text-fg">{zh ? 'Codemode 读取试点' : 'Codemode read pilot'}</span>
              <span className="mt-1 block text-sm text-fg-muted">{zh ? '允许智能体用脚本组合已授权的读取工具。默认关闭，保留普通工具调用。' : 'Let agents combine authorized reads in scripts. Off by default; ordinary tool calls stay available.'}</span>
            </span>
          </label>
        </section>
        <section className="rounded-xl bg-surface-hover/20 p-5">
          <h2 className="text-base font-semibold text-fg">{zh ? '执行限制' : 'Execution limits'}</h2>
          <p className="mt-1 text-sm text-fg-muted">{zh ? '为所有智能体设置安全上限；留空时使用系统默认值。' : 'Set safe upper bounds for every agent. Empty fields use system defaults.'}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">

            <label className="block text-xs font-medium text-fg-muted">{zh ? '每次运行最多轮数' : 'Maximum turns per run'}<NumberInput allowEmpty type="number" min={1} value={draft.runtime.maxTurns ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, maxTurns: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
            <label className="block text-xs font-medium text-fg-muted">{zh ? '单轮超时（毫秒）' : 'Turn timeout (ms)'}<NumberInput allowEmpty type="number" min={1} value={draft.runtime.timeoutMs ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, timeoutMs: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
            <label className="block text-xs font-medium text-fg-muted">{zh ? '每轮最多工具失败次数' : 'Maximum tool failures per turn'}<NumberInput allowEmpty type="number" min={1} value={draft.runtime.maxToolFailuresPerTurn ?? ''} placeholder={zh ? '系统默认' : 'System default'} onChange={(event) => setDraft({ ...draft, runtime: { ...draft.runtime, maxToolFailuresPerTurn: positiveInt(event.target.value) } })} className={`${inputClass} mt-2`} /></label>
          </div>
        </section>

        <section className="rounded-xl bg-surface-hover/20 p-5">
          <h2 className="text-base font-semibold text-fg">{zh ? '提示词缓存' : 'Prompt cache'}</h2>
          <p className="mt-1 text-sm text-fg-muted">{zh ? '复用稳定的上下文以降低响应延迟和模型费用。' : 'Reuse stable context to reduce latency and model cost.'}</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存模式' : 'Cache mode'}</span><SlidingTabList className="mt-1.5 flex rounded-lg bg-surface-panel p-1" role="group" aria-label={zh ? "缓存模式" : "Cache mode"}>{(['auto', 'off'] as const).map((mode) => <Button aria-pressed={draft.runtime.promptCache?.mode === mode} key={mode} variant={draft.runtime.promptCache?.mode === mode ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { mode, lifetime: draft.runtime.promptCache?.lifetime ?? 'short' } } })}>{mode === 'auto' ? (zh ? '自动' : 'Automatic') : (zh ? '关闭' : 'Off')}</Button>)}</SlidingTabList></div>
            {draft.runtime.promptCache?.mode === 'auto' ? <div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存周期' : 'Cache lifetime'}</span><SlidingTabList className="mt-1.5 flex rounded-lg bg-surface-panel p-1" role="group" aria-label={zh ? "缓存周期" : "Cache lifetime"}>{(['short', 'long'] as const).map((lifetime) => <Button aria-pressed={draft.runtime.promptCache?.lifetime === lifetime} key={lifetime} variant={draft.runtime.promptCache?.lifetime === lifetime ? 'secondary' : 'ghost'} className="flex-1 py-1.5 text-xs" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { mode: 'auto', lifetime } } })}>{lifetime === 'short' ? (zh ? '短期' : 'Short') : (zh ? '长期' : 'Long')}</Button>)}</SlidingTabList></div> : null}
          </div>
        </section>

      </SettingsAdvancedSection>

    </div>
  );
}
