import { SPECIALIST_VOCABULARY, type SpecialistProfile } from '@xopcai/gateway-contract';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SelectOptionList } from '@/components/ui/popover-select';

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

const vocabularyLabels: Record<string, string> = {
  general: '通用', coordination: '协调', software: '软件开发', writing: '写作', research: '研究', data: '数据', design: '设计', operations: '运营',
  general_assistance: '日常协助', task_planning: '任务规划', bug_fix: '修复 Bug', implementation: '功能开发', code_review: '代码审查', editing: '编辑润色', news_research: '新闻研究', data_analysis: '数据分析', data_cleaning: '数据清洗', image_generation: '生成图片', automation: '自动化',
  text: '文本', repository: '代码仓库', csv: 'CSV', spreadsheet: '电子表格', web_page: '网页', image: '图片',
  answer: '回答', plan: '计划', code_patch: '代码修改', document: '文档', report: '报告', chart: '图表', script: '脚本', design_brief: '设计说明',
};

function VocabularyField({ field, value, label, zh, onChange }: {
  field: keyof typeof SPECIALIST_VOCABULARY; value: string[]; label: string; zh: boolean; onChange: (values: string[]) => void;
}) {
  const vocabulary: readonly string[] = SPECIALIST_VOCABULARY[field];
  const custom = value.filter(item => !vocabulary.includes(item));
  const display = (item: string) => zh ? vocabularyLabels[item] ?? item : item.replaceAll('_', ' ');
  return <details className="min-w-0 rounded-xl border border-edge p-3">
    <summary className="cursor-pointer text-sm font-medium text-fg">
      {label}<span className="mt-1 block text-xs font-normal text-fg-muted">{value.length ? value.map(display).join(' · ') : (zh ? '选择适用项' : 'Select applicable items')}</span>
    </summary>
    <div className="mt-3 space-y-3">
      <SelectOptionList options={vocabulary.map(item => ({ value: item, label: display(item), disabled: value.length >= 16 && !value.includes(item) }))}
        values={value} multiple ariaLabel={label} onChange={onChange} />
      <details><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '自定义标识' : 'Custom identifiers'}</summary>
        <ListField value={custom} label={zh ? '其他标识' : 'Other identifiers'} hint={zh ? '每行一个英文标识' : 'One identifier per line'} max={16}
          onChange={items => onChange([...new Set([...value.filter(item => vocabulary.includes(item)), ...items])])} />
      </details>
    </div>
  </details>;
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
      <div><h4 className="text-sm font-semibold text-fg">{zh ? '擅长的任务' : 'Specialties'}</h4>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '声明专长，帮助系统匹配任务。实际执行还需具备相应模型、技能、工具和账号权限。' : 'Describe expertise for task matching. Execution also requires the appropriate models, skills, tools, and account access.'}</p></div>
      <Button variant="ghost" onClick={() => onChange(profile ? undefined : structuredClone(emptyProfile))}>
        {profile ? (zh ? '清除档案' : 'Clear profile') : (zh ? '添加档案' : 'Add profile')}
      </Button>
    </div>
    {profile ? <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{fields.slice(0, 2).map(([key, label]) =>
        <VocabularyField key={key} field={key as 'domains' | 'taskTypes'} value={profile[key]} label={label} zh={zh}
          onChange={value => onChange({ ...profile, [key]: value })} />)}</div>
      <ListField value={profile.specialties} label={zh ? '具体专长' : 'Specialties'} hint={zh ? '每行一项，例如：React 应用调试' : 'One specialty per line'} max={8} onChange={specialties => onChange({ ...profile, specialties })} />
      <details className="rounded-xl border border-edge p-4">
        <summary className="cursor-pointer text-sm font-medium text-fg">{zh ? '任务匹配细节' : 'Task matching details'}<span className="ml-2 text-xs font-normal text-fg-muted">{zh ? `${profile.inputKinds.length} 项输入 · ${profile.outputKinds.length} 项交付 · ${profile.examples.length} 个示例` : `${profile.inputKinds.length} inputs · ${profile.outputKinds.length} outputs · ${profile.examples.length} examples`}</span></summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">{fields.slice(2, 4).map(([key, label]) =>
            <VocabularyField key={key} field={key as 'inputKinds' | 'outputKinds'} value={profile[key]} label={label} zh={zh}
              onChange={value => onChange({ ...profile, [key]: value })} />)}</div>
          <ListField value={profile.limitations} label={zh ? '适用边界' : 'Limitations'} hint={zh ? '每行一项边界或注意事项' : 'One limitation per line'} max={8} onChange={limitations => onChange({ ...profile, limitations })} />
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
        </div>
      </details>
    </div> : <p className="mt-3 text-xs text-fg-subtle">{zh ? '未设置档案时，继续按现有角色描述和执行条件匹配。' : 'Without a profile, matching continues using the existing role and execution conditions.'}</p>}
  </section>;
}
