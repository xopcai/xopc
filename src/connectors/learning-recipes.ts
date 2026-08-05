export type ConnectorLearningRecipe = {
  toolkit: string;
  actionId: string;
  arguments: Record<string, unknown>;
  bootstrapWindowDays: number;
  intervalMinutes: number;
};

export function buildConnectorLearningArguments(
  recipe: ConnectorLearningRecipe,
  input: { cursor?: string; windowStart?: string },
): Record<string, unknown> {
  if (!input.cursor) return { ...recipe.arguments };
  if (recipe.toolkit === 'gmail') {
    const after = Math.floor(Date.parse(input.cursor) / 1_000);
    return Number.isFinite(after)
      ? { ...recipe.arguments, query: `after:${after} -in:spam -in:trash` }
      : { ...recipe.arguments };
  }
  if (recipe.toolkit === 'googlecalendar') {
    return { ...recipe.arguments, time_min: input.cursor };
  }
  return { ...recipe.arguments };
}

const RECIPES: Record<string, ConnectorLearningRecipe> = {
  gmail: {
    toolkit: 'gmail',
    actionId: 'GMAIL_FETCH_EMAILS',
    arguments: { max_results: 100, query: 'newer_than:30d -in:spam -in:trash' },
    bootstrapWindowDays: 30,
    intervalMinutes: 15,
  },
  googlecalendar: {
    toolkit: 'googlecalendar',
    actionId: 'GOOGLECALENDAR_LIST_EVENTS',
    arguments: { max_results: 200 },
    bootstrapWindowDays: 90,
    intervalMinutes: 15,
  },
  googledrive: {
    toolkit: 'googledrive',
    actionId: 'GOOGLEDRIVE_SEARCH_FILES',
    arguments: {},
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  notion: {
    toolkit: 'notion',
    actionId: 'NOTION_SEARCH',
    arguments: {},
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  slack: {
    toolkit: 'slack',
    actionId: 'SLACK_LIST_CHANNELS',
    arguments: {},
    bootstrapWindowDays: 30,
    intervalMinutes: 15,
  },
  github: {
    toolkit: 'github',
    actionId: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
    arguments: {},
    bootstrapWindowDays: 90,
    intervalMinutes: 30,
  },
  linear: {
    toolkit: 'linear',
    actionId: 'LINEAR_LIST_ISSUES',
    arguments: {},
    bootstrapWindowDays: 60,
    intervalMinutes: 15,
  },
};

export function getConnectorLearningRecipe(toolkit: string): ConnectorLearningRecipe | undefined {
  return RECIPES[toolkit.trim().toLowerCase()];
}

export function listConnectorLearningRecipes(): ConnectorLearningRecipe[] {
  return Object.values(RECIPES);
}
