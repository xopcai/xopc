import type { Plugin } from 'vite';
export type DependencyRecord = { name: string; version: string; license: string; repository: unknown; notices: { file: string; text: string }[] };
export function dependencyRecords(inputs: Iterable<string>, root: string): DependencyRecord[];
export function dependencyInventoryPlugin(root: string): Plugin;
export function writeDependencyRecords(path: string, inputs: Iterable<string>, root: string): void;
export function windowsSigningBoundary(path: string, kind?: string): string;
export function createDesktopInventory(packDir: string, root: string, target: { platform: string; arch: string }): Record<string, unknown>;
