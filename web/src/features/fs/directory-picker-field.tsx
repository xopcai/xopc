import { useDirectoryPicker } from '@/features/fs/use-directory-picker';
import { DirectoryPickerTrigger } from '@/features/fs/directory-picker-trigger';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import type { MessageBundle } from '@/i18n/messages';

type Props = {
  value: string;
  onChange: (path: string) => void | Promise<void>;
  disabled?: boolean;
  wd: MessageBundle['chat']['workingDirectory'];
  placeholder?: string;
  title?: string;
  maxWidthClass?: string;
  /** When set, show a clear link next to the trigger. */
  clearLabel?: string;
  onClear?: () => void;
};

export function DirectoryPickerField({
  value,
  onChange,
  disabled,
  wd,
  placeholder,
  title,
  maxWidthClass,
  clearLabel,
  onClear,
}: Props) {
  const picker = useDirectoryPicker({ initialPath: value, onPicked: onChange });

  const trimmed = value.trim();
  const resolvedTitle =
    title ??
    (trimmed
      ? `${trimmed}\n${wd.chooseFolder}`
      : `${placeholder ?? wd.notSet}\n${wd.selectWorkingDirectory}`);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <DirectoryPickerTrigger
          value={value}
          onPick={picker.pick}
          disabled={disabled || picker.picking}
          placeholder={placeholder ?? wd.notSet}
          title={resolvedTitle}
          maxWidthClass={maxWidthClass}
        />
        {clearLabel && trimmed && onClear ? (
          <button
            type="button"
            disabled={disabled || picker.picking}
            className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
            onClick={onClear}
          >
            {clearLabel}
          </button>
        ) : null}
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
