import { z } from 'zod';

import { ENDPOINT_FILE_OUTPUT_SCHEMA } from './shared-schemas.js';
import { canonicalJson } from './canonical-json.js';
import type { EndpointToolDescriptor, EndpointTurnClaim } from './index.js';

export const DEVICE_FOLDER_SEARCH = 'desktop.folder.search';
export const DEVICE_FOLDER_READ = 'desktop.folder.read';
export const DEVICE_FOLDER_PRESETS = ['desktop', 'documents', 'downloads'] as const;
export const deviceFolderKindSchema = z.enum([...DEVICE_FOLDER_PRESETS, 'custom']);
export type DeviceFolderKind = z.infer<typeof deviceFolderKindSchema>;

export const deviceFolderGrantSchema = z.strictObject({
  id: z.uuid(),
  kind: deviceFolderKindSchema,
  label: z.string().trim().min(1).max(120),
  mobileIds: z.array(z.string().min(1).max(160)).max(32),
});
export type DeviceFolderGrant = z.infer<typeof deviceFolderGrantSchema>;
export const deviceFolderSnapshotSchema = z.strictObject({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  folders: z.array(deviceFolderGrantSchema).max(20),
});
export type DeviceFolderSnapshot = z.infer<typeof deviceFolderSnapshotSchema>;

export function deviceFolderSigningPayload(origin: EndpointTurnClaim, snapshot: DeviceFolderSnapshot): string {
  return canonicalJson({ action: 'publish-device-folders', origin, snapshot });
}

export type DeviceConnection = {
  id: string;
  name: string;
  kind: 'mobile' | 'desktop';
  platform: string;
  endpointId?: string;
  availability: 'foreground' | 'background' | 'offline';
  tools: string[];
  folders: Array<Omit<DeviceFolderGrant, 'mobileIds'>>;
};
export type DeviceConnections = {
  currentDeviceId?: string;
  devices: DeviceConnection[];
};

export function isDeviceFolderTool(name: string): boolean {
  return name === DEVICE_FOLDER_SEARCH || name === DEVICE_FOLDER_READ;
}

const folderId = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const modifiedAt = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 };

export function deviceFolderDescriptors(): EndpointToolDescriptor[] {
  const common = {
    policyId: 'personal.desktop-folder-read',
    sensitivity: 'personal',
    effect: 'read',
    confirmation: 'never',
    requiresForeground: false,
    requiredPermissions: ['folder-read'],
    timeoutMs: 25_000,
    maxConcurrency: 2,
    supportsCancellation: true,
    idempotent: true,
  } as const;
  return [{
    ...common,
    requiredPermissions: [...common.requiredPermissions],
    name: DEVICE_FOLDER_SEARCH,
    title: 'Find files in an authorized computer folder',
    description: 'Find files by name in a selected computer folder. Use an authorized folder ID from the tool description. Share the computer and folder name with the results.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['folderId', 'query'],
      properties: { folderId, query: { type: 'string', minLength: 1, maxLength: 160 }, modifiedAfter: modifiedAt, modifiedBefore: modifiedAt },
    },
    outputSchema: {
      type: 'array', minItems: 1, maxItems: 1, items: {
        type: 'object', additionalProperties: false, required: ['type', 'value'], properties: {
          type: { const: 'json' }, value: {
            type: 'object', additionalProperties: false, required: ['folderId', 'folder', 'files', 'truncated'], properties: {
              folderId, folder: { type: 'string', maxLength: 120 }, truncated: { type: 'boolean' },
              files: { type: 'array', maxItems: 20, items: {
                type: 'object', additionalProperties: false, required: ['ref', 'name', 'modifiedAt', 'size'],
                properties: { ref: folderId, name: { type: 'string', maxLength: 255 }, modifiedAt, size: { type: 'integer', minimum: 0 } },
              } },
            },
          },
        },
      },
    },
    resultKinds: ['json'],
  }, {
    ...common,
    requiredPermissions: [...common.requiredPermissions],
    name: DEVICE_FOLDER_READ,
    title: 'Read a file found in an authorized computer folder',
    description: 'Read a file from this computer using its recent search result ref and folder ID. Confirm the requested file when multiple matches are ambiguous.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['folderId', 'ref'], properties: { folderId, ref: folderId } },
    outputSchema: ENDPOINT_FILE_OUTPUT_SCHEMA,
    resultKinds: ['file'],
  }];
}

export const deviceFolderChangeSchema = z.union([
  z.strictObject({ kind: deviceFolderKindSchema, mobileIds: z.array(z.string().min(1).max(160)).max(32) }),
  z.strictObject({ id: z.uuid(), mobileIds: z.array(z.string().min(1).max(160)).max(32) }),
  z.strictObject({ id: z.uuid(), revoke: z.literal(true) }),
]);
export type DeviceFolderChange = z.infer<typeof deviceFolderChangeSchema>;
