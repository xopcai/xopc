export function matchesCommandPath(
  commandPath: string[],
  pattern: readonly string[],
  options?: { exact?: boolean },
): boolean {
  if (options?.exact && commandPath.length !== pattern.length) {
    return false;
  }
  if (commandPath.length < pattern.length) {
    return false;
  }
  return pattern.every((segment, index) => commandPath[index] === segment);
}
