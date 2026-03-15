/**
 * ACP Secret File Reader
 */

import { readFileSync } from "node:fs";

/**
 * Read secret from file
 */
export function readSecretFromFile(path: string, name: string): string {
  try {
    const content = readFileSync(path, { encoding: "utf-8" });
    return content.trim();
  } catch (error) {
    throw new Error(`Failed to read ${name} from file "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
