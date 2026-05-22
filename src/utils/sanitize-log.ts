/** Strip control chars from log labels (server names, keys). */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '?');
}
