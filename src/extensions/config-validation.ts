import Ajv from 'ajv';

const validator = new Ajv({ allErrors: true, strict: false });

export type ExtensionConfigValidationResult =
  | { valid: true }
  | { valid: false; reason: string; errors?: unknown };

export function validateExtensionConfig(
  schema: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
): ExtensionConfigValidationResult {
  if (!schema) return { valid: true };

  try {
    const validate = validator.compile(schema);
    if (validate(config)) return { valid: true };
    return {
      valid: false,
      reason: validator.errorsText(validate.errors, { separator: '; ' }),
      errors: validate.errors,
    };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
