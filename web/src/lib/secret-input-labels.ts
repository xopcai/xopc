import type { SecretInputLabels } from '@/components/ui/secret-input';

export const DEFAULT_SECRET_INPUT_LABELS: SecretInputLabels = {
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied',
};

/** Map providers settings copy to {@link SecretInput} labels. */
export function secretInputLabelsFromProvidersSettings(labels: {
  showKey: string;
  hideKey: string;
  copy: string;
  copied: string;
}): SecretInputLabels {
  return {
    show: labels.showKey,
    hide: labels.hideKey,
    copy: labels.copy,
    copied: labels.copied,
  };
}

/** Map channel settings copy to {@link SecretInput} labels. */
export function secretInputLabelsFromChannels(labels: {
  show: string;
  hide: string;
  copy: string;
  copied: string;
}): SecretInputLabels {
  return {
    show: labels.show,
    hide: labels.hide,
    copy: labels.copy,
    copied: labels.copied,
  };
}

/** Map gateway settings copy to {@link SecretInput} labels. */
export function secretInputLabelsFromGateway(labels: {
  show: string;
  hide: string;
  copy: string;
  copied: string;
}): SecretInputLabels {
  return secretInputLabelsFromChannels(labels);
}

/** Map shell token dialog copy to {@link SecretInput} labels. */
export function secretInputLabelsFromToken(labels: {
  show: string;
  hide: string;
}): SecretInputLabels {
  return {
    show: labels.show,
    hide: labels.hide,
    copy: 'Copy',
    copied: 'Copied',
  };
}
