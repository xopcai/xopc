import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@sinclair/typebox';

import type { BrowserRecipeService } from '../../browser/recipes/index.js';

const BrowserRecipeToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal('list'),
    Type.Literal('get'),
    Type.Literal('save'),
    Type.Literal('enable'),
    Type.Literal('disable'),
    Type.Literal('delete'),
    Type.Literal('run'),
  ]),
  recipeId: Type.Optional(Type.String({ description: 'Workflow id for get, enable, disable, delete, or run.' })),
  yaml: Type.Optional(Type.String({ description: 'Canonical Browser Recipe v1 YAML generated internally when saving.' })),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Typed workflow inputs for a run.' })),
});

type BrowserRecipeToolInput = Static<typeof BrowserRecipeToolSchema>;

function result(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], details };
}

function presentWorkflow(recipe: ReturnType<BrowserRecipeService['get']>) {
  if (!recipe) return undefined;
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    enabled: recipe.status === 'published',
    risk: recipe.risk,
    domains: recipe.domains,
  };
}

export function createBrowserRecipeTool(deps: {
  getBrowserRecipeService: () => BrowserRecipeService | undefined;
}): AgentTool<typeof BrowserRecipeToolSchema, Record<string, unknown>> {
  return {
    name: 'browser_recipe',
    label: 'Browser Automation',
    description: 'Create and manage reusable browser automations for the user. Use save after a successful browser_use sequence when the user asks to save or repeat it. The yaml field is an internal Browser Recipe document: apiVersion must be xopc.ai/browser-recipe/v1; include kebab-case id, user-facing name and description, risk, exact domains, typed args, and pipeline. Every pipeline step has exactly one action with an object value. Use ${{ args.name }} for variable inputs. New saves are enabled immediately. Only delete on an explicit user request. Users should never need to write or see this YAML.',
    parameters: BrowserRecipeToolSchema,
    async execute(_toolCallId, params: BrowserRecipeToolInput, signal) {
      const service = deps.getBrowserRecipeService();
      if (!service) return result('Browser automation is not available.', { ok: false });
      if (params.action === 'list') {
        const recipes = service.list();
        const text = recipes.length === 0
          ? 'No browser automations.'
          : recipes.map((recipe) => `- ${recipe.id}: ${recipe.name} (${recipe.status === 'published' ? 'enabled' : 'paused'}, ${recipe.risk})`).join('\n');
        return result(text, { workflows: recipes.map(presentWorkflow) });
      }
      const recipeId = params.recipeId?.trim();
      if (params.action === 'save') {
        if (!params.yaml?.trim()) return result('The internal definition is required to save a browser automation.', { ok: false });
        try {
          const recipe = service.save({ yaml: params.yaml });
          return result(`Saved and enabled browser automation: ${recipe.name}`, { ok: true, workflow: presentWorkflow(recipe) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return result(`Could not save browser automation: ${message}`, { ok: false, error: message });
        }
      }
      if (!recipeId) return result('recipeId is required.', { ok: false });
      if (params.action === 'get') {
        const recipe = service.get(recipeId);
        if (!recipe) return result(`Browser automation not found: ${recipeId}`, { ok: false });
        return result(`${recipe.name}\nEnabled: ${recipe.status === 'published' ? 'yes' : 'no'}\nRisk: ${recipe.risk}\nDomains: ${recipe.domains.join(', ')}`, { workflow: presentWorkflow(recipe) });
      }
      if (params.action === 'enable' || params.action === 'disable') {
        const recipe = service.get(recipeId);
        if (!recipe) return result(`Browser automation not found: ${recipeId}`, { ok: false });
        const saved = service.save({
          yaml: recipe.yaml,
          status: params.action === 'enable' ? 'published' : 'disabled',
          expectedId: recipe.id,
        });
        return result(`${saved.name} is now ${params.action === 'enable' ? 'enabled' : 'disabled'}.`, { ok: true, workflow: presentWorkflow(saved) });
      }
      if (params.action === 'delete') {
        try {
          const removed = service.remove(recipeId);
          return result(removed ? `Deleted browser automation: ${recipeId}` : `Browser automation not found: ${recipeId}`, { ok: removed });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return result(`Could not delete browser automation: ${message}`, { ok: false, error: message });
        }
      }
      try {
        const run = await service.runAndWait(recipeId, params.args ?? {}, signal);
        const text = run.status === 'succeeded'
          ? `Browser automation ${recipeId} completed.`
          : `Browser automation ${recipeId} ${run.status}: ${run.error ?? 'No error details'}`;
        return result(text, { ok: run.status === 'succeeded', run });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return result(`Browser automation failed: ${message}`, { ok: false, error: message });
      }
    },
  };
}
