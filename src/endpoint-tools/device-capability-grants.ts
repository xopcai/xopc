import { desktopCapabilityTitles, desktopDeviceChatToolSchema, mobileDeviceChatToolSchema, type DesktopCapabilitySnapshot, type DesktopDeviceChatTool, type DeviceChatTool, type MobileDeviceChatTool } from '@xopcai/endpoint-tools-protocol';

import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import type { EndpointConnectionSnapshot } from './registry.js';

const grants = new DurableState<MobileDeviceChatTool[]>('device.mobile-capability-grants');
const toolNames: ReadonlySet<string> = new Set(mobileDeviceChatToolSchema.options);
const desktopTools: ReadonlySet<string> = new Set(desktopDeviceChatToolSchema.options);
const desktopGrants = new DurableState<DesktopCapabilitySnapshot>('device.desktop-capability-grants');
export const mobileCapabilityTitles: Record<MobileDeviceChatTool, readonly [string, string]> = {
  'mobile.file.pick': ['文件', 'Files'],
  'mobile.media.pick': ['照片', 'Photos'],
  'mobile.camera.capture': ['拍照', 'Camera'],
  'mobile.contacts.pick': ['联系人', 'Contacts'],
  'mobile.contacts.find_by_name': ['查找联系人', 'Find contacts'],
  'mobile.calendar.query_events': ['查看日程', 'Read calendar'],
  'mobile.calendar.query_free_busy': ['查看日历空闲时间', 'Check calendar availability'],
  'mobile.calendar.create_event': ['创建日程', 'Create events'],
  'mobile.media.list_recent': ['最近照片', 'Recent photos'],
  'mobile.media.read_image': ['读取照片', 'Read photos'],
  'mobile.media.add_to_album': ['整理相册', 'Organize albums'],
  'mobile.device.get_location': ['位置', 'Location'],
  'mobile.device.get_state': ['设备信息', 'Device information'],
  'mobile.device.get_power': ['电量', 'Battery'],
};

export const deviceCapabilityTitles: Record<DeviceChatTool, readonly [string, string]> = {
  ...mobileCapabilityTitles, ...desktopCapabilityTitles,
};

export function isMobileDeviceCapability(name: string): name is MobileDeviceChatTool {
  return toolNames.has(name);
}

export function isDesktopDeviceCapability(name: string): name is DesktopDeviceChatTool {
  return desktopTools.has(name);
}

type CapabilityEndpoint = Pick<EndpointConnectionSnapshot, 'kind' | 'principalId' | 'executionAuthority'>;

export function isManagedDeviceCapability(endpoint: CapabilityEndpoint, name: string): name is DeviceChatTool {
  return endpoint.kind === 'mobile' ? isMobileDeviceCapability(name)
    : endpoint.kind === 'desktop' && !endpoint.executionAuthority && isDesktopDeviceCapability(name);
}

export function deviceCapabilityAllowed(endpoint: CapabilityEndpoint, name: string): boolean {
  if (endpoint.kind === 'mobile' && isMobileDeviceCapability(name)) return mobileCapabilityAllowed(endpoint.principalId, name);
  return endpoint.kind === 'desktop' && !endpoint.executionAuthority && isDesktopDeviceCapability(name)
    && isXopcDatabaseOpen() && desktopGrants.get(endpoint.principalId)?.allowed.includes(name) === true;
}

export function saveDesktopCapabilitySnapshot(deviceId: string, snapshot: DesktopCapabilitySnapshot): DesktopDeviceChatTool[] | undefined {
  return desktopGrants.update(deviceId, previous => {
    if (previous && (previous.revision > snapshot.revision
      || previous.revision === snapshot.revision && JSON.stringify(previous.allowed) !== JSON.stringify(snapshot.allowed))) {
      return { value: previous, result: undefined };
    }
    return { value: snapshot, result: previous?.allowed.filter(name => !snapshot.allowed.includes(name)) ?? [] };
  });
}

export function mobileCapabilityAllowed(deviceId: string, toolName: MobileDeviceChatTool): boolean {
  return isXopcDatabaseOpen() && grants.get(deviceId)?.includes(toolName) === true;
}

export function setMobileCapabilityAllowed(deviceId: string, toolName: MobileDeviceChatTool, allowed: boolean): void {
  grants.update(deviceId, previous => {
    const next = new Set(previous);
    if (allowed) next.add(toolName);
    else next.delete(toolName);
    return { value: next.size ? [...next] : undefined, result: undefined };
  });
}
