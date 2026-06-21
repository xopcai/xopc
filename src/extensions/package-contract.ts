export const PACKAGE_DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export interface PackageDependencyIssue {
  section: (typeof PACKAGE_DEPENDENCY_SECTIONS)[number];
  name: string;
  version: string;
  code: 'workspace_dependency' | 'host_sdk_runtime_dependency' | 'ui_sdk_runtime_dependency';
  message: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function dependencyVersion(pkg: Record<string, unknown>, section: string, name: string): string | undefined {
  const deps = pkg[section];
  if (!isRecord(deps)) return undefined;
  const value = deps[name];
  return typeof value === 'string' ? value : undefined;
}

export function collectExtensionPackageDependencyIssues(
  pkg: Record<string, unknown>,
  options: { strictRuntimeSdkDeps?: boolean } = {},
): PackageDependencyIssue[] {
  const issues: PackageDependencyIssue[] = [];
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!isRecord(deps)) continue;
    for (const [name, rawVersion] of Object.entries(deps)) {
      if (typeof rawVersion !== 'string') continue;
      if (rawVersion.startsWith('workspace:')) {
        issues.push({
          section,
          name,
          version: rawVersion,
          code: 'workspace_dependency',
          message: `${section}.${name} uses ${rawVersion}; published extensions must not depend on workspace protocols.`,
        });
      }
    }
  }

  if (options.strictRuntimeSdkDeps) {
    const hostRuntime = dependencyVersion(pkg, 'dependencies', '@xopcai/xopc');
    if (hostRuntime) {
      issues.push({
        section: 'dependencies',
        name: '@xopcai/xopc',
        version: hostRuntime,
        code: 'host_sdk_runtime_dependency',
        message:
          '@xopcai/xopc must not be a runtime dependency of an extension package; use devDependencies for types and optional peerDependencies for host compatibility.',
      });
    }
    const uiRuntime = dependencyVersion(pkg, 'dependencies', '@xopcai/extension-ui-sdk');
    if (uiRuntime) {
      issues.push({
        section: 'dependencies',
        name: '@xopcai/extension-ui-sdk',
        version: uiRuntime,
        code: 'ui_sdk_runtime_dependency',
        message:
          '@xopcai/extension-ui-sdk should be bundled into static UI assets and kept in devDependencies, not runtime dependencies.',
      });
    }
  }

  return issues;
}

export function hasWorkspaceProtocolDependencies(pkg: Record<string, unknown>): boolean {
  return collectExtensionPackageDependencyIssues(pkg).some((x) => x.code === 'workspace_dependency');
}
