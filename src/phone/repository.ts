import { randomUUID } from 'node:crypto';

import { normalizePhoneAppAccess } from './app-access.js';

import { DurableState } from '../storage/sqlite/durable-state.js';
import { PhoneDeviceSchema, PhoneError, type PhoneDevice, type PhoneReport } from './contracts.js';

function parseDevice(value: PhoneDevice): PhoneDevice {
  const { agentIds: _removed, ...device } = value as PhoneDevice & { agentIds?: unknown };
  return normalizePhoneAppAccess(PhoneDeviceSchema.parse(device));
}

type Lease = { token: string; expiresAt: number };

/** Small settings and latest metadata-only reports; pixels and input text are never stored. */
export class PhoneRepository {
  private devices = new DurableState<PhoneDevice>('phone.devices');
  private preferences = new DurableState<string>('phone.preferences');
  private leases = new DurableState<Lease>('phone.leases');
  private reports = new DurableState<PhoneReport>('phone.reports');

  list(): PhoneDevice[] { return this.devices.values().map(value => parseDevice(value)); }
  get(id: string): PhoneDevice {
    const value = this.devices.get(id);
    if (!value) throw new PhoneError('PHONE_DEVICE_NOT_FOUND', 'Phone is not registered', 404);
    return parseDevice(value);
  }
  save(input: Omit<PhoneDevice, 'id' | 'createdAt' | 'revision'>, id?: string): PhoneDevice {
    const previous = id ? this.get(id) : undefined;
    if (this.list().some(device => device.serial === input.serial && device.id !== id)) throw new PhoneError('PHONE_DEVICE_DUPLICATE', 'This ADB device is already registered');
    if (input.wireless && this.list().some(device => device.id !== id && device.wireless?.hardwareSerial === input.wireless.hardwareSerial))
      throw new PhoneError('PHONE_DEVICE_DUPLICATE', 'This wireless phone is already registered; reconnect it from the device menu');
    const next = normalizePhoneAppAccess(PhoneDeviceSchema.parse({ ...input, id: id ?? randomUUID(), createdAt: previous?.createdAt ?? Date.now(), revision: (previous?.revision ?? 0) + 1 }));
    this.devices.set(next.id, next);
    return next;
  }
  remove(id: string): void {
    this.get(id); this.devices.delete(id);
    if (this.defaultDevice() === id) this.preferences.delete('defaultDevice');
  }
  defaultDevice(): string | undefined { return this.preferences.get('defaultDevice'); }
  setDefault(id: string): void { this.get(id); this.preferences.set('defaultDevice', id); }
  acquire(serial: string): string {
    const token = randomUUID();
    this.leases.update(serial, lease => {
      if (lease && lease.expiresAt > Date.now()) throw new PhoneError('PHONE_DEVICE_BUSY', 'Phone is controlled by another session', 409);
      return { value: { token, expiresAt: Date.now() + 120_000 }, result: undefined };
    });
    return token;
  }
  renew(serial: string, token: string): void {
    this.leases.update(serial, lease => {
      if (!lease || lease.token !== token || lease.expiresAt <= Date.now()) throw new PhoneError('PHONE_LEASE_LOST', 'Device control expired; close and reopen the phone', 409);
      return { value: { token, expiresAt: Date.now() + 120_000 }, result: undefined };
    });
  }
  leaseActive(serial: string): boolean { return (this.leases.get(serial)?.expiresAt ?? 0) > Date.now(); }
  release(serial: string, token: string): void {
    this.leases.update(serial, lease => ({ value: lease?.token === token ? undefined : lease, result: undefined }));
  }
  report(value: PhoneReport): void {
    // Screen facts are transient; only bounded operational metadata survives restart.
    const { facts: _facts, message: _message, readings: _readings, ...metadata } = value;
    this.reports.set(value.sessionId, metadata);
    const all = this.reports.entries();
    for (const [id] of all.slice(0, Math.max(0, all.length - 50))) this.reports.delete(id);
  }
  history(): PhoneReport[] {
    return this.reports.values(50, true).map(report => ['ready', 'running', 'paused', 'needs_user'].includes(report.status)
      ? { ...report, status: 'paused', stopReason: 'restart_requires_reopen' } : report);
  }
}
