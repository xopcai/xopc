const COMPOSIO_PLUGIN_REPLACEMENTS: Readonly<Record<string, string>> = {
  notion: 'notion-office',
  todoist: 'todoist',
};

const STORE_CONNECTOR_REPLACEMENTS: Readonly<Record<string, string>> = {
  notion: 'Store plugin "notion-office"',
  'todoist-mcp': 'Store plugin "todoist"',
};

export function isExcludedComposioToolkit(toolkit: string): boolean {
  return Object.hasOwn(COMPOSIO_PLUGIN_REPLACEMENTS, toolkit.trim().toLowerCase());
}

export function assertComposioToolkitAvailable(toolkit: string): void {
  const slug = toolkit.trim().toLowerCase();
  if (isExcludedComposioToolkit(slug)) {
    throw new Error(`Use Store plugin "${COMPOSIO_PLUGIN_REPLACEMENTS[slug]}" instead of the duplicate Composio connector.`);
  }
}

export function isExcludedStoreConnector(packageName: string): boolean {
  return Object.hasOwn(STORE_CONNECTOR_REPLACEMENTS, packageName);
}

export function assertStoreConnectorAvailable(packageName: string): void {
  if (isExcludedStoreConnector(packageName)) {
    throw new Error(`Use ${STORE_CONNECTOR_REPLACEMENTS[packageName]} instead of the duplicate Store connector.`);
  }
}
