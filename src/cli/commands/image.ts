import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { parseModelRef, type AgentModelConfig } from '../../config/schema.js';
import {
  resolveAgentModelPrimaryValue,
  resolveAgentModelFallbackValues,
} from '../../config/model-input.js';
import { isProviderConfigured } from '../../providers/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';
import { getContextWithOpts } from '../index.js';

function modelRefToString(model?: AgentModelConfig): string | null {
  if (!model) {
    return null;
  }
  return resolveAgentModelPrimaryValue(model) ?? null;
}

function modelFallbacksToArray(model?: AgentModelConfig): string[] {
  return resolveAgentModelFallbackValues(model);
}

function createImageCommand(_ctx: CLIContext): Command {
  const cmd = new Command('image')
    .description('Configure image generation and understanding models')
    .addHelpText(
      'after',
      formatExamples([
        'xopc image status                              # Show current image config',
        'xopc image set-understanding openai/gpt-4o     # Set image understanding model',
        'xopc image set-generation openai/gpt-image-1   # Set image generation model',
        'xopc image add-fallback understanding anthropic/claude-sonnet-4-5',
        'xopc image add-fallback generation qwen/wan2.6-t2i',
        'xopc image remove-fallback understanding 0     # Remove first fallback',
        'xopc image providers                           # List available providers',
      ]),
    );

  cmd
    .command('status')
    .description('Show current image model configuration')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const ctx = getContextWithOpts();
      const config = loadConfig(ctx.configPath);
      const defaults = config.agents?.defaults;

      const understandingPrimary = modelRefToString(defaults?.imageModel);
      const understandingFallbacks = modelFallbacksToArray(defaults?.imageModel);
      const generationPrimary = modelRefToString(defaults?.imageGenerationModel);
      const generationFallbacks = modelFallbacksToArray(defaults?.imageGenerationModel);
      const mediaMaxMb = defaults?.mediaMaxMb;

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              imageUnderstanding: {
                primary: understandingPrimary,
                fallbacks: understandingFallbacks,
              },
              imageGeneration: {
                primary: generationPrimary,
                fallbacks: generationFallbacks,
              },
              mediaMaxMb: mediaMaxMb ?? null,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log('');
      console.log(colors.cyan('Image multimodal configuration'));
      console.log('═'.repeat(50));

      console.log('');
      console.log(colors.cyan('Image understanding (vision)'));
      if (understandingPrimary) {
        const parsed = parseModelRef(understandingPrimary);
        const configured = parsed ? await isProviderConfigured(parsed.provider) : false;
        const status = configured ? colors.green('OK') : colors.yellow('(provider not configured)');
        console.log(`  Primary: ${understandingPrimary} ${status}`);
      } else {
        console.log(`  Primary: ${colors.gray('(not set — inferred from keys / defaults)')}`);
      }
      for (let i = 0; i < understandingFallbacks.length; i++) {
        const fb = understandingFallbacks[i]!;
        const parsed = parseModelRef(fb);
        const configured = parsed ? await isProviderConfigured(parsed.provider) : false;
        const status = configured ? colors.green('OK') : colors.yellow('?');
        console.log(`  Fallback ${i + 1}: ${fb} ${status}`);
      }

      console.log('');
      console.log(colors.cyan('Image generation'));
      if (generationPrimary) {
        const parsed = parseModelRef(generationPrimary);
        const configured = parsed ? await isProviderConfigured(parsed.provider) : false;
        const status = configured ? colors.green('OK') : colors.yellow('(provider not configured)');
        console.log(`  Primary: ${generationPrimary} ${status}`);
      } else {
        console.log(`  Primary: ${colors.gray('(not set — defaults to openai/gpt-image-1)')}`);
      }
      for (let i = 0; i < generationFallbacks.length; i++) {
        const fb = generationFallbacks[i]!;
        const parsed = parseModelRef(fb);
        const configured = parsed ? await isProviderConfigured(parsed.provider) : false;
        const status = configured ? colors.green('OK') : colors.yellow('?');
        console.log(`  Fallback ${i + 1}: ${fb} ${status}`);
      }

      console.log('');
      console.log(colors.cyan('General'));
      console.log(`  Max image size: ${mediaMaxMb ? `${mediaMaxMb} MB` : colors.gray('(default)')}`);

      console.log('');
      console.log('═'.repeat(50));
      console.log(
        colors.gray(
          'Use "xopc image set-understanding" / "xopc image set-generation" to set primary models.',
        ),
      );
      console.log('');
    });

  cmd
    .command('set-understanding <modelRef>')
    .description('Set the primary image understanding (vision) model')
    .action(async (modelRef: string) => {
      const parsed = parseModelRef(modelRef);
      if (!parsed) {
        console.error(
          colors.red(`Invalid model reference: "${modelRef}". Use "provider/model" format.`),
        );
        process.exit(1);
      }

      const configured = await isProviderConfigured(parsed.provider);
      if (!configured) {
        console.warn(
          colors.yellow(
            `Provider "${parsed.provider}" is not configured. Set the API key before using this model.`,
          ),
        );
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) {
        config.agents = { defaults: {} } as typeof config.agents;
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {} as typeof config.agents.defaults;
      }

      const existingFallbacks = modelFallbacksToArray(config.agents.defaults.imageModel);
      if (existingFallbacks.length > 0) {
        config.agents.defaults.imageModel = {
          primary: modelRef,
          fallbacks: existingFallbacks,
        };
      } else {
        config.agents.defaults.imageModel = modelRef;
      }

      await saveConfig(config, configPath);
      console.log(colors.green(`Image understanding model set to: ${modelRef}`));
    });

  cmd
    .command('set-generation <modelRef>')
    .description('Set the primary image generation model')
    .action(async (modelRef: string) => {
      const parsed = parseModelRef(modelRef);
      if (!parsed) {
        console.error(
          colors.red(`Invalid model reference: "${modelRef}". Use "provider/model" format.`),
        );
        process.exit(1);
      }

      const configured = await isProviderConfigured(parsed.provider);
      if (!configured) {
        console.warn(
          colors.yellow(
            `Provider "${parsed.provider}" is not configured. Set the API key before using this model.`,
          ),
        );
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) {
        config.agents = { defaults: {} } as typeof config.agents;
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {} as typeof config.agents.defaults;
      }

      const existingFallbacks = modelFallbacksToArray(config.agents.defaults.imageGenerationModel);
      if (existingFallbacks.length > 0) {
        config.agents.defaults.imageGenerationModel = {
          primary: modelRef,
          fallbacks: existingFallbacks,
        };
      } else {
        config.agents.defaults.imageGenerationModel = modelRef;
      }

      await saveConfig(config, configPath);
      console.log(colors.green(`Image generation model set to: ${modelRef}`));
    });

  cmd
    .command('add-fallback <type> <modelRef>')
    .description('Add a fallback model (type: "understanding" or "generation")')
    .action(async (type: string, modelRef: string) => {
      if (type !== 'understanding' && type !== 'generation') {
        console.error(colors.red('Type must be "understanding" or "generation".'));
        process.exit(1);
      }

      const parsed = parseModelRef(modelRef);
      if (!parsed) {
        console.error(
          colors.red(`Invalid model reference: "${modelRef}". Use "provider/model" format.`),
        );
        process.exit(1);
      }

      const configured = await isProviderConfigured(parsed.provider);
      if (!configured) {
        console.warn(colors.yellow(`Provider "${parsed.provider}" is not configured.`));
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) {
        config.agents = { defaults: {} } as typeof config.agents;
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {} as typeof config.agents.defaults;
      }

      const configKey = type === 'understanding' ? 'imageModel' : 'imageGenerationModel';
      const current = config.agents.defaults[configKey];
      const primary = resolveAgentModelPrimaryValue(current);
      const fallbacks = [...resolveAgentModelFallbackValues(current)];

      if (!primary) {
        const hint =
          type === 'understanding'
            ? 'xopc image set-understanding <model>'
            : 'xopc image set-generation <model>';
        console.error(colors.red(`No primary model set for image ${type}. Set it first: ${hint}`));
        process.exit(1);
      }

      if (fallbacks.includes(modelRef)) {
        console.warn(colors.yellow(`"${modelRef}" is already in the fallback list.`));
        return;
      }

      fallbacks.push(modelRef);
      config.agents.defaults[configKey] = { primary, fallbacks };

      await saveConfig(config, configPath);
      console.log(colors.green(`Added fallback for image ${type}: ${modelRef}`));
      console.log(colors.gray(`   Fallback chain: ${primary} -> ${fallbacks.join(' -> ')}`));
    });

  cmd
    .command('remove-fallback <type> <index>')
    .description('Remove a fallback model by index (0-based)')
    .action(async (type: string, indexStr: string) => {
      if (type !== 'understanding' && type !== 'generation') {
        console.error(colors.red('Type must be "understanding" or "generation".'));
        process.exit(1);
      }

      const index = parseInt(indexStr, 10);
      if (Number.isNaN(index) || index < 0) {
        console.error(colors.red('Index must be a non-negative integer.'));
        process.exit(1);
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      const configKey = type === 'understanding' ? 'imageModel' : 'imageGenerationModel';
      const current = config.agents?.defaults?.[configKey];
      const primary = resolveAgentModelPrimaryValue(current);
      const fallbacks = [...resolveAgentModelFallbackValues(current)];

      if (index >= fallbacks.length) {
        console.error(
          colors.red(`Fallback index ${index} out of range (${fallbacks.length} fallbacks).`),
        );
        process.exit(1);
      }

      const removed = fallbacks.splice(index, 1)[0];

      if (!config.agents) {
        config.agents = { defaults: {} } as typeof config.agents;
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {} as typeof config.agents.defaults;
      }

      if (fallbacks.length > 0 && primary) {
        config.agents.defaults[configKey] = { primary, fallbacks };
      } else if (primary) {
        config.agents.defaults[configKey] = primary;
      }

      await saveConfig(config, configPath);
      console.log(colors.green(`Removed fallback: ${removed}`));
    });

  cmd
    .command('providers')
    .description('List image-capable providers and configuration status')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const imageProviders: Record<string, { generation: string[]; understanding: string[] }> = {
        openai: {
          generation: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
          understanding: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
        },
        anthropic: {
          generation: [],
          understanding: ['claude-sonnet-4-5', 'claude-haiku-3-5'],
        },
        google: {
          generation: [],
          understanding: ['gemini-2.0-flash', 'gemini-1.5-pro'],
        },
        qwen: {
          generation: ['wan2.6-t2i'],
          understanding: ['qwen-vl-max', 'qwen2.5-vl-72b-instruct'],
        },
      };

      const results: Array<{
        provider: string;
        configured: boolean;
        generation: string[];
        understanding: string[];
      }> = [];
      for (const [providerId, capabilities] of Object.entries(imageProviders)) {
        const configured = await isProviderConfigured(providerId);
        results.push({ provider: providerId, configured, ...capabilities });
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log('');
      console.log(colors.cyan('Image-capable providers'));
      console.log('═'.repeat(60));

      for (const row of results) {
        const statusIcon = row.configured ? colors.green('OK') : colors.yellow('?');
        const statusText = row.configured ? 'configured' : 'not configured';
        console.log('');
        console.log(`  ${statusIcon} ${row.provider} (${statusText})`);

        if (row.generation.length > 0) {
          console.log(`     Generation: ${row.generation.map((m) => `${row.provider}/${m}`).join(', ')}`);
        }
        if (row.understanding.length > 0) {
          console.log(
            `     Understanding: ${row.understanding.map((m) => `${row.provider}/${m}`).join(', ')}`,
          );
        }
      }

      console.log('');
      console.log('═'.repeat(60));
      console.log(colors.gray('Use "xopc auth set <provider>" to configure API keys.'));
      console.log('');
    });

  cmd
    .command('set-max-size <mb>')
    .description('Set maximum image size in MB')
    .action(async (mbStr: string) => {
      const mb = parseFloat(mbStr);
      if (Number.isNaN(mb) || mb <= 0) {
        console.error(colors.red('Size must be a positive number (in MB).'));
        process.exit(1);
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) {
        config.agents = { defaults: {} } as typeof config.agents;
      }
      if (!config.agents.defaults) {
        config.agents.defaults = {} as typeof config.agents.defaults;
      }
      config.agents.defaults.mediaMaxMb = mb;

      await saveConfig(config, configPath);
      console.log(colors.green(`Max image size set to: ${mb} MB`));
    });

  return cmd;
}

register({
  id: 'image',
  name: 'image',
  description: 'Configure image generation and understanding models',
  factory: createImageCommand,
  metadata: {
    category: 'utility',
    examples: [
      'xopc image status',
      'xopc image set-understanding openai/gpt-4o',
      'xopc image set-generation openai/gpt-image-1',
      'xopc image providers',
    ],
  },
});
