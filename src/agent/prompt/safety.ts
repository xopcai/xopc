// Safety System - Quick safety check for file operations

/**
 * Quick safety check for file operations
 */
export function checkFileSafety(
  operation: 'read' | 'write' | 'delete',
  path: string
): { allowed: boolean; message?: string } {
  // Check for sensitive paths
  const sensitivePaths = [
    '/etc/passwd',
    '/etc/shadow',
    '/root/.ssh',
    '/home/*/.ssh',
    '~/.aws',
    '~/.bashrc',
    '~/.profile',
  ];

  for (const sp of sensitivePaths) {
    if (path.includes(sp)) {
      return {
        allowed: false,
        message: `Cannot ${operation} sensitive path: ${path}`,
      };
    }
  }

  return { allowed: true };
}

