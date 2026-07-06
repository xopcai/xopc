import { useCallback, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native-paper';

import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';

type GatewayTokenInputProps = Omit<TextInputProps, 'secureTextEntry' | 'right'> & {
  onCopied?: () => void;
  onCopyFailed?: () => void;
  copyAccessibilityLabel: string;
  showAccessibilityLabel: string;
  hideAccessibilityLabel: string;
};

export function GatewayTokenInput({
  value,
  onCopied,
  onCopyFailed,
  copyAccessibilityLabel,
  showAccessibilityLabel,
  hideAccessibilityLabel,
  ...rest
}: GatewayTokenInputProps) {
  const [visible, setVisible] = useState(false);

  const handleCopy = useCallback(() => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    void setAppClipboardStringAsync(text)
      .then(() => onCopied?.())
      .catch(() => onCopyFailed?.());
  }, [onCopied, onCopyFailed, value]);

  const hasValue = typeof value === 'string' && value.trim().length > 0;

  return (
    <TextInput
      {...rest}
      value={value}
      autoCapitalize="none"
      secureTextEntry={!visible}
      right={
        <>
          <TextInput.Icon
            icon="content-copy"
            disabled={!hasValue}
            onPress={handleCopy}
            accessibilityLabel={copyAccessibilityLabel}
          />
          <TextInput.Icon
            icon={visible ? 'eye-off' : 'eye'}
            onPress={() => setVisible((v) => !v)}
            accessibilityLabel={visible ? hideAccessibilityLabel : showAccessibilityLabel}
          />
        </>
      }
    />
  );
}
