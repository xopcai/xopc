export function userTextBubbleWidth(text: string, minimum: number): string {
  let lineUnits = 0;
  let widestLineUnits = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      widestLineUnits = Math.max(widestLineUnits, lineUnits);
      lineUnits = 0;
    } else if (code !== 13) {
      lineUnits += code > 255 ? 1 : 0.55;
    }
  }
  widestLineUnits = Math.max(widestLineUnits, lineUnits);
  return Math.max(minimum, Math.min(360, Math.ceil(widestLineUnits * 16) + 30)) + 'vp';
}
