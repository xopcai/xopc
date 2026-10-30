import { join } from 'node:path';

import { resolveStateDir } from '../config/paths-state.js';

export const HDC_VERSION = '3.2.0c';
export const HOSCRCPY_VERSION = '1.0.18-beta';
export const HOSCRCPY_SHA256 = '2ce60b1893cc2be471a8cd7eab7e4127e41921f1f89a32a134c730ba15c8c0fd';
export const managedHdcDir = (stateDir = resolveStateDir()) => join(stateDir, 'tools', 'hdc', `${HDC_VERSION}-hdw2-2.3.10`);
export const managedHdcPath = (stateDir = resolveStateDir()) => join(managedHdcDir(stateDir), process.platform === 'win32' ? 'hdc.exe' : 'hdc');
export const managedHosDir = (stateDir = resolveStateDir()) => join(stateDir, 'tools', 'hoscrcpy', HOSCRCPY_VERSION);
export const managedHosJar = (stateDir = resolveStateDir()) => join(managedHosDir(stateDir), `hosScrcpy-${HOSCRCPY_VERSION}.jar`);
export const managedJavaDir = (stateDir = resolveStateDir()) => join(stateDir, 'tools', 'phone-java', 'current');
export const managedJavaHome = (stateDir = resolveStateDir()) => process.platform === 'darwin' ? join(managedJavaDir(stateDir), 'Contents', 'Home') : managedJavaDir(stateDir);
