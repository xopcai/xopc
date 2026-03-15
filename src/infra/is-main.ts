/**
 * Is Main Module Utility
 */

interface IsMainModuleOptions {
  currentFile: string;
}

/**
 * Check if the current module is the main entry point
 */
export function isMainModule(options: IsMainModuleOptions): boolean {
  const isTestEnv = !!process.env.VITEST || !!process.env.TEST || !!process.env.NODE_ENV?.includes("test");
  if (isTestEnv) {
    return false;
  }
  
  // Check if the current file is the main module
  try {
    const currentUrl = import.meta.url;
    return currentUrl.startsWith("file:") && options.currentFile === process.argv[1];
  } catch {
    return false;
  }
}
