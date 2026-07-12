import type { ReactNode } from 'react';

import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { DirectoryPickerTrigger } from '@/features/fs/directory-picker-trigger';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type Props = {
  value: string;
  onChange: (path: string) => void | Promise<void>;
  disabled?: boolean;
  wd: MessageBundle['chat']['workingDirectory'];
  placeholder?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  /** Buttons after the folder picker (e.g. set default). */
  trailing?: ReactNode;
};

/** Path input on the left; folder picker (+ optional actions) on the right — stacks on small screens. */
export function DirectoryPickerPathField({
  value,
  onChange,
  disabled,
  wd,
  placeholder,
  inputClassName,
  autoFocus,
  trailing,
}: Props) {
  const picker = useDirectoryPicker({ initialPath: value, onPicked: onChange });

  const trimmed = value.trim();
  const pickTitle = trimmed
    ? `${trimmed}\n${wd.chooseFolder}`
    : `${placeholder ?? wd.notSet}\n${wd.selectWorkingDirectory}`;

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          className={cn('min-w-0 flex-1', inputClassName)}
          value={value}
          disabled={disabled || picker.picking}
          onChange={(e) => void onChange(e.target.value)}
          placeholder={placeholder ?? wd.pathInputPlaceholder}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DirectoryPickerTrigger
            compact
            value={value}
            onPick={picker.pick}
            disabled={disabled || picker.picking}
            title={pickTitle}
            aria-label={wd.selectWorkingDirectory}
          />
          {trailing}
        </div>
      </div>

      {!picker.hasNativePicker ? (
        <WorkingDirectoryPickerModal
          open={picker.modalOpen}
          onOpenChange={picker.setModalOpen}
          initialAbsolutePath={trimmed || undefined}
          onConfirm={picker.confirmPick}
          wd={wd}
        />
      ) : null}
    </>
  );
}
