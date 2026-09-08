import { PopoverSelect } from '@/components/ui/popover-select';

import type { BrowserAutomation, BrowserAutomationInput } from './browser-automation-api';

function InputField({ name, input, value, yes, no, onChange }: {
  name: string;
  input: BrowserAutomationInput;
  value: unknown;
  yes: string;
  no: string;
  onChange: (value: unknown) => void;
}) {
  const label = input.description?.trim() || name;
  if (input.choices?.length) {
    const options = input.choices.map((choice) => ({ value: JSON.stringify(choice), label: String(choice) }));
    return <label className="block text-sm text-fg"><span className="mb-1.5 block font-medium">{label}{input.required ? ' *' : ''}</span><PopoverSelect value={value === undefined ? '' : JSON.stringify(value)} options={options} placeholder={label} onChange={(next) => onChange(JSON.parse(next))} /></label>;
  }
  if (input.type === 'boolean') {
    return <label className="block text-sm text-fg"><span className="mb-1.5 block font-medium">{label}{input.required ? ' *' : ''}</span><PopoverSelect value={typeof value === 'boolean' ? String(value) : ''} options={[{ value: 'true', label: yes }, { value: 'false', label: no }]} placeholder={label} onChange={(next) => onChange(next === 'true')} /></label>;
  }
  const numeric = input.type === 'number';
  return <label className="block text-sm text-fg"><span className="mb-1.5 block font-medium">{label}{input.required ? ' *' : ''}</span><input type={numeric ? 'number' : 'text'} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(numeric ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value)} className="h-10 w-full rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none focus:border-accent" /></label>;
}

export function BrowserAutomationInputFields({ automation, values, language, onChange }: {
  automation: BrowserAutomation;
  values: Record<string, unknown>;
  language: 'en' | 'zh';
  onChange: (values: Record<string, unknown>) => void;
}) {
  return <div className="grid gap-4">{Object.entries(automation.inputs).map(([name, input]) => <InputField key={name} name={name} input={input} value={values[name]} yes={language === 'zh' ? '是' : 'Yes'} no={language === 'zh' ? '否' : 'No'} onChange={(value) => onChange({ ...values, [name]: value })} />)}</div>;
}
