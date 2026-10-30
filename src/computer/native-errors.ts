/** Only explicit native codes establish unsupported background delivery. */
export function computerNativeInputError(value: unknown, fallback: string): Error {
  const data = value && typeof value === 'object' ? value as { errorCode?: unknown; error?: { code?: unknown }; action?: { error?: { code?: unknown } } } : undefined;
  const code = data?.error?.code ?? data?.action?.error?.code ?? data?.errorCode;
  return new Error(typeof code === 'string' && [
    'background_input_unsupported', 'background_delivery_unsupported', 'unsupported_background_delivery',
  ].includes(code.toLowerCase()) ? 'COMPUTER_BACKGROUND_INPUT_UNSUPPORTED' : fallback);
}
