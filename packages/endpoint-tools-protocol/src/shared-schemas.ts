export const ENDPOINT_FILE_OUTPUT_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 20,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'fileId', 'name', 'mimeType', 'size', 'sha256'],
    properties: {
      type: { const: 'file' },
      fileId: { type: 'string', minLength: 1, maxLength: 160 },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      mimeType: { type: 'string', minLength: 1, maxLength: 255 },
      size: { type: 'integer', minimum: 0 },
      sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  },
} as const;

export const ENDPOINT_CONTACT_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'phones', 'emails'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 512 },
    name: { type: 'string', minLength: 1, maxLength: 500 },
    phones: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
    emails: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 320 } },
  },
} as const;

function contactOutputSchema(multiple: boolean) {
  return {
    type: 'array',
    minItems: 1,
    maxItems: 1,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'value'],
      properties: {
        type: { const: 'json' },
        value: multiple
          ? { type: 'array', maxItems: 20, items: ENDPOINT_CONTACT_RECORD_SCHEMA }
          : ENDPOINT_CONTACT_RECORD_SCHEMA,
      },
    },
  } as const;
}

export const ENDPOINT_CONTACT_OUTPUT_SCHEMA = contactOutputSchema(false);
export const ENDPOINT_CONTACT_LIST_OUTPUT_SCHEMA = contactOutputSchema(true);

export const DEVICE_EMPTY_INPUT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const;

