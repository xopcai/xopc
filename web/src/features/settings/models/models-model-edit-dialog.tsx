import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { type ModelsSettingsMessages } from '@/i18n/messages';

import { createCustomModel, type CustomModel } from '../models-json-api';

import {
  inputClassName,
  INPUT_OPTIONS,
  inputFromSelect,
  parseInputSelect,
  selectClassName,
} from './models-settings-lib';

type ModelDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  providerId: string | null;
  model: CustomModel | null;
  isNew: boolean;
  onSave: (model: CustomModel) => void;
  m: ModelsSettingsMessages;
};

export function ModelEditDialogContent({
  open,
  onOpenChange,
  providerId,
  model,
  isNew,
  onSave,
  m,
}: ModelDialogProps) {
  const [form, setForm] = useState<Partial<CustomModel>>(() => createCustomModel(''));
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!open) return;
    setErrors(new Map());
    setForm(model ? { ...model } : createCustomModel(''));
  }, [open, model]);

  const update = <K extends keyof CustomModel>(field: K, value: CustomModel[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(field);
      return next;
    });
  };

  const validate = (): boolean => {
    const next = new Map<string, string>();
    const id = (form.id || '').trim();
    if (!id) next.set('id', m.modelIdRequired);
    if (form.contextWindow !== undefined && form.contextWindow <= 0) {
      next.set('contextWindow', m.mustBePositive);
    }
    if (form.maxTokens !== undefined && form.maxTokens <= 0) {
      next.set('maxTokens', m.mustBePositive);
    }
    setErrors(next);
    return next.size === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const id = (form.id || '').trim();
    const result: CustomModel = {
      ...form,
      id,
      name: form.name?.trim() || id,
      reasoning: form.reasoning || false,
      input: form.input || ['text'],
      contextWindow: form.contextWindow ?? 128000,
      maxTokens: form.maxTokens ?? 16384,
      cost: {
        input: form.cost?.input ?? 0,
        output: form.cost?.output ?? 0,
        cacheRead: form.cost?.cacheRead ?? 0,
        cacheWrite: form.cost?.cacheWrite ?? 0,
      },
    };
    onSave(result);
    onOpenChange(false);
  };

  const inputSel = parseInputSelect(form as CustomModel);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-50 max-h-[min(90vh,720px)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">
                {isNew ? m.addModelTitle : m.editModelTitle}
              </Dialog.Title>
              {providerId ? (
                <p className="mt-0.5 text-xs text-fg-muted">
                  {m.modelProviderLabel}: {providerId}
                </p>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-base hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={m.close}
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg">
                {m.modelId}
                <span className="text-red-600 dark:text-red-400"> *</span>
              </label>
              <input
                className={cn(inputClassName(), errors.has('id') && 'border-red-500')}
                value={form.id || ''}
                onChange={(e) => update('id', e.target.value)}
                placeholder="e.g. llama3.1:8b"
                disabled={!isNew}
              />
              {errors.has('id') ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('id')}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">{m.displayName}</label>
              <input
                className={inputClassName()}
                value={form.name || ''}
                onChange={(e) => update('name', e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.inputTypes}</label>
                <select
                  className={selectClassName()}
                  value={inputSel}
                  onChange={(e) => update('input', inputFromSelect(e.target.value))}
                >
                  {INPUT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {m[opt.labelKey]}
                    </option>
                  ))}
                </select>
              </div>
              <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={form.reasoning || false}
                  onChange={(e) => update('reasoning', e.target.checked)}
                />
                {m.reasoning}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.contextWindow}</label>
                <input
                  type="number"
                  min={1}
                  className={cn(inputClassName(), errors.has('contextWindow') && 'border-red-500')}
                  value={form.contextWindow ?? 128000}
                  onChange={(e) => update('contextWindow', parseInt(e.target.value, 10) || 0)}
                />
                {errors.has('contextWindow') ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('contextWindow')}</p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-fg-muted">{m.maxOutputTokens}</label>
                <input
                  type="number"
                  min={1}
                  className={cn(inputClassName(), errors.has('maxTokens') && 'border-red-500')}
                  value={form.maxTokens ?? 16384}
                  onChange={(e) => update('maxTokens', parseInt(e.target.value, 10) || 0)}
                />
                {errors.has('maxTokens') ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.get('maxTokens')}</p>
                ) : null}
              </div>
            </div>
            <div className="border-t border-edge-subtle pt-2 dark:border-edge">
              <p className="mb-2 text-xs font-semibold text-fg">{m.costSection}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-fg-muted">{m.costInput}</label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className={inputClassName()}
                    value={form.cost?.input ?? 0}
                    onChange={(e) =>
                      update('cost', {
                        ...form.cost,
                        input: parseFloat(e.target.value) || 0,
                        output: form.cost?.output ?? 0,
                        cacheRead: form.cost?.cacheRead ?? 0,
                        cacheWrite: form.cost?.cacheWrite ?? 0,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-fg-muted">{m.costOutput}</label>
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className={inputClassName()}
                    value={form.cost?.output ?? 0}
                    onChange={(e) =>
                      update('cost', {
                        ...form.cost,
                        input: form.cost?.input ?? 0,
                        output: parseFloat(e.target.value) || 0,
                        cacheRead: form.cost?.cacheRead ?? 0,
                        cacheWrite: form.cost?.cacheWrite ?? 0,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
            <Dialog.Close asChild>
              <Button type="button" variant="secondary">
                {m.cancel}
              </Button>
            </Dialog.Close>
            <Button type="button" className="bg-accent text-white hover:bg-accent/90" onClick={handleSave}>
              {isNew ? m.addModelConfirm : m.saveModelConfirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
