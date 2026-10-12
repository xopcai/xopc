import type { SpecialistProfile } from '@xopcai/gateway-contract';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

const emptyProfile: SpecialistProfile = { version: 1, domains: [], taskTypes: [], inputKinds: [], outputKinds: [], specialties: [], examples: [], limitations: [] };
const fieldClass = 'mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent';
const parse = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);

function ListField({ value, label, hint, onChange, max }: {
  value: string[]; label: string; hint: string; onChange: (value: string[]) => void; max: number;
}) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    if (JSON.stringify(parse(text)) !== JSON.stringify(value)) setText(value.join('\n'));
  }, [value, text]);
  return <label className="text-xs font-medium text-fg-muted">{label}
    <textarea rows={3} className={fieldClass} value={text} placeholder={hint} onChange={event => {
      setText(event.target.value);
      onChange(parse(event.target.value));
    }} />
    <span className="text-xs text-fg-subtle">{parse(text).length}/{max}</span>
  </label>;
}

export function SpecialistProfileEditor({ profile, zh, onChange }: {
  profile?: SpecialistProfile; zh: boolean; onChange: (profile: SpecialistProfile | undefined) => void;
}) {
  const fields = [
    ['domains', zh ? '领域' : 'Domains', 'software\ndata\nresearch', 16],
    ['taskTypes', zh ? '任务类型' : 'Task types', 'bug_fix\ncode_review\ndata_analysis', 16],
    ['inputKinds', zh ? '输入类型' : 'Input kinds', 'repository\ncsv\ntext', 16],
    ['outputKinds', zh ? '交付类型' : 'Output kinds', 'code_patch\nreport\nchart', 16],
    ['specialties', zh ? '具体专长' : 'Specialties', zh ? '每行一项具体专长' : 'One specialty per line', 8],
    ['limitations', zh ? '适用边界' : 'Limitations', zh ? '每行一项边界或注意事项' : 'One limitation per line', 8],
  ] as const;
  return <section className="rounded-2xl border border-edge bg-surface-base p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><h4 className="text-sm font-semibold text-fg">{zh ? 'Specialist 能力档案' : 'Specialist profile'}</h4>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '声明专长以帮助任务匹配。每行一项；领域和类型使用简短英文标识。工具、Skill 和账号权限由系统另行检查。' : 'Describe expertise for task matching. One item per line; use short English identifiers for domains and kinds. Tools, Skills and account access are checked separately.'}</p></div>
      <Button variant="ghost" onClick={() => onChange(profile ? undefined : structuredClone(emptyProfile))}>
        {profile ? (zh ? '清除档案' : 'Clear profile') : (zh ? '添加档案' : 'Add profile')}
      </Button>
    </div>
    {profile ? <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, hint, max]) =>
        <ListField key={key} value={profile[key]} label={label} hint={hint} max={max}
          onChange={value => onChange({ ...profile, [key]: value })} />)}</div>
      <div className="space-y-3"><h5 className="text-xs font-medium text-fg-muted">{zh ? '适用示例' : 'Examples'}</h5>
        {profile.examples.map((example, index) => <div key={index} className="rounded-xl border border-edge p-3">
          <label className="text-xs text-fg-muted">{zh ? '请求' : 'Request'}<textarea rows={2} maxLength={200} className={fieldClass} value={example.request}
            onChange={event => onChange({ ...profile, examples: profile.examples.map((item, i) => i === index ? { ...item, request: event.target.value } : item) })} /></label>
          <label className="text-xs text-fg-muted">{zh ? '交付成果' : 'Deliverable'}<textarea rows={2} maxLength={200} className={fieldClass} value={example.deliverable}
            onChange={event => onChange({ ...profile, examples: profile.examples.map((item, i) => i === index ? { ...item, deliverable: event.target.value } : item) })} /></label>
          <Button variant="ghost" onClick={() => onChange({ ...profile, examples: profile.examples.filter((_, i) => i !== index) })}>{zh ? '移除示例' : 'Remove example'}</Button>
        </div>)}
        <Button variant="ghost" disabled={profile.examples.length >= 4} onClick={() => onChange({ ...profile, examples: [...profile.examples, { request: '', deliverable: '' }] })}>{zh ? '添加示例' : 'Add example'}</Button>
      </div>
    </div> : <p className="mt-3 text-xs text-fg-subtle">{zh ? '未设置档案时，继续按现有角色描述和执行条件匹配。' : 'Without a profile, matching continues using the existing role and execution conditions.'}</p>}
  </section>;
}
