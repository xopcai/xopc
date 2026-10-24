import { PhoneError, type PhoneApplication } from './contracts.js';
import { SCRCPY_VERSION } from '../runtime-tools/phone-dependency-catalog.js';

const packageName = /^[a-zA-Z]\w*(?:\.\w+)+$/;
export function phoneApplicationsCommand(remote: string): string[] {
  return ['env', `CLASSPATH=${remote}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
    'list_apps=true', 'video=false', 'audio=false', 'control=false'];
}

/** Parse the pinned scrcpy server's app list, including wrapped long labels. */
export function parsePhoneApplications(raw: string): PhoneApplication[] {
  const text = raw.replace(/\u001b\[[\d;]*m/g, '');
  if (text.length > 1024 * 1024 || !text.includes('List of apps:')) throw new PhoneError('PHONE_APPS_UNAVAILABLE', 'Unable to read the phone application list. Check the phone connection and scrcpy dependency.');
  const apps = new Map<string, PhoneApplication>();
  let pending: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const entry = /^\s*[*-]\s+(.+)$/.exec(line);
    if (entry) {
      const match = /^(.*?)\s+([a-zA-Z]\w*(?:\.\w+)+)$/.exec(entry[1].trim());
      if (match) { pending = undefined; apps.set(match[2], { packageName: match[2], label: match[1].trim().slice(0, 120) || match[2] }); }
      else pending = entry[1].trim().slice(0, 120);
    } else if (pending && packageName.test(line.trim())) {
      apps.set(line.trim(), { packageName: line.trim(), label: pending }); pending = undefined;
    }
    if (apps.size > 500) throw new PhoneError('PHONE_APPS_LIMIT', 'Phone application list exceeds 500 entries');
  }
  return [...apps.values()].sort((a, b) => a.label.localeCompare(b.label));
}
