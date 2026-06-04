import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { parseModelRef, type AgentModelConfig } from '../../config/schema.js';
import {
  resolveAgentModelPrimaryValue,
  resolveAgentModelFallbackValues,
} from '../../config/model-input.js';
import { isProviderConfigured } from '../../providers/index.js';
import {
  generateImage,
  getImageGenerationProvider,
  listImageGenerationProvidersSummary,
} from '../../agent/image/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';
import { getContextWithOpts } from '../context.js';

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
        'xopc image add-fallback generation dashscope/wan2.7-image-pro',
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
      config.agents.defaults.imageModel =
        existingFallbacks.length > 0
          ? { primary: modelRef, fallbacks: existingFallbacks }
          : { primary: modelRef };

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
      config.agents.defaults.imageGenerationModel =
        existingFallbacks.length > 0
          ? { primary: modelRef, fallbacks: existingFallbacks }
          : { primary: modelRef };

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

      if (primary) {
        config.agents.defaults[configKey] =
          fallbacks.length > 0 ? { primary, fallbacks } : { primary };
      }

      await saveConfig(config, configPath);
      console.log(colors.green(`Removed fallback: ${removed}`));
    });

  cmd
    .command('providers')
    .description('List registered image-generation providers and their capabilities')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);

      const summaries = listImageGenerationProvidersSummary(config);
      const rows = summaries.map((s) => {
        const provider = getImageGenerationProvider(s.id, config);
        let configured = false;
        try {
          configured = provider?.isConfigured?.({ cfg: config }) === true;
        } catch {
          configured = false;
        }
        return {
          id: s.id,
          label: s.label ?? s.id,
          defaultModel: s.defaultModel ?? null,
          models: s.models,
          aliases: s.aliases ?? [],
          capabilities: s.capabilities ?? null,
          configured,
        };
      });

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      console.log('');
      console.log(colors.cyan('Image-generation providers'));
      console.log('═'.repeat(60));

      if (rows.length === 0) {
        console.log('');
        console.log(
          colors.yellow(
            '  No image-generation providers registered. Check `extensions/<vendor>/` and bundled.ts.',
          ),
        );
        console.log('');
        return;
      }

      for (const row of rows) {
        const statusIcon = row.configured ? colors.green('OK') : colors.yellow('?');
        const statusText = row.configured ? 'configured' : 'missing API key';
        console.log('');
        console.log(`  ${statusIcon} ${row.label} (${row.id}) — ${statusText}`);
        if (row.defaultModel) console.log(`     Default: ${row.defaultModel}`);
        if (row.models.length > 0) {
          console.log(`     Models:  ${row.models.map((m) => `${row.id}/${m}`).join(', ')}`);
        }
        if (row.aliases.length > 0) {
          console.log(`     Aliases: ${row.aliases.join(', ')}`);
        }
      }

      console.log('');
      console.log('═'.repeat(60));
      console.log(
        colors.gray(
          'Use `xopc image set-generation <provider/model>` to set the primary model, ' +
            '`xopc auth set <provider>` to configure API keys.',
        ),
      );
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

  cmd
    .command('set-timeout <ms>')
    .description('Set the per-request timeout (ms) for image generation; 0 to clear')
    .action(async (msStr: string) => {
      const ms = parseInt(msStr, 10);
      if (Number.isNaN(ms) || ms < 0) {
        console.error(colors.red('Timeout must be a non-negative integer (ms).'));
        process.exit(1);
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) config.agents = { defaults: {} } as typeof config.agents;
      if (!config.agents.defaults) config.agents.defaults = {} as typeof config.agents.defaults;

      const current = config.agents.defaults.imageGenerationModel;
      const primary = resolveAgentModelPrimaryValue(current);
      if (!primary) {
        console.error(
          colors.red('No image generation model is configured. Run `xopc image set-generation <provider/model>` first.'),
        );
        process.exit(1);
      }
      const fallbacks = resolveAgentModelFallbackValues(current);
      const autoProviderFallback = current?.autoProviderFallback === true;

      if (ms === 0) {
        config.agents.defaults.imageGenerationModel = {
          primary,
          ...(fallbacks.length > 0 ? { fallbacks } : {}),
          ...(autoProviderFallback ? { autoProviderFallback: true } : {}),
        };
        await saveConfig(config, configPath);
        console.log(colors.green('Image generation timeout cleared.'));
        return;
      }

      config.agents.defaults.imageGenerationModel = {
        primary,
        ...(fallbacks.length > 0 ? { fallbacks } : {}),
        ...(autoProviderFallback ? { autoProviderFallback: true } : {}),
        timeoutMs: ms,
      };
      await saveConfig(config, configPath);
      console.log(colors.green(`Image generation timeout set to: ${ms}ms`));
    });

  cmd
    .command('set-auto-fallback <on-or-off>')
    .description('Enable / disable sweeping every configured provider when primary chain fails')
    .action(async (value: string) => {
      const v = value.trim().toLowerCase();
      const enable = v === 'on' || v === 'true' || v === '1' || v === 'yes';
      const disable = v === 'off' || v === 'false' || v === '0' || v === 'no';
      if (!enable && !disable) {
        console.error(colors.red('Value must be "on" or "off".'));
        process.exit(1);
      }

      const configPath = getContextWithOpts().configPath;
      const config = loadConfig(configPath);
      if (!config.agents) config.agents = { defaults: {} } as typeof config.agents;
      if (!config.agents.defaults) config.agents.defaults = {} as typeof config.agents.defaults;

      const current = config.agents.defaults.imageGenerationModel;
      const primary = resolveAgentModelPrimaryValue(current);
      if (!primary) {
        console.error(
          colors.red('No image generation model is configured. Run `xopc image set-generation <provider/model>` first.'),
        );
        process.exit(1);
      }
      const fallbacks = resolveAgentModelFallbackValues(current);
      const timeoutMs = current?.timeoutMs;

      if (disable) {
        config.agents.defaults.imageGenerationModel = {
          primary,
          ...(fallbacks.length > 0 ? { fallbacks } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        };
        await saveConfig(config, configPath);
        console.log(colors.green('Image generation auto-fallback disabled.'));
        return;
      }

      config.agents.defaults.imageGenerationModel = {
        primary,
        ...(fallbacks.length > 0 ? { fallbacks } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
        autoProviderFallback: true,
      };
      await saveConfig(config, configPath);
      console.log(colors.green('Image generation auto-fallback enabled.'));
    });

  cmd
    .command('generate <prompt...>')
    .description('Generate one or more images and save them to disk')
    .option('--model <ref>', 'Model ref (provider/model); falls back to configured primary')
    .option('--size <size>', 'Image size, e.g. 1024x1024')
    .option('--count <n>', 'Number of images to generate', (v) => parseInt(v, 10), 1)
    .option('--output <dir>', 'Output directory (default: ./generated-images)')
    .option('--timeout <ms>', 'Per-call timeout (ms)', (v) => parseInt(v, 10))
    .action(
      async (
        promptParts: string[],
        opts: { model?: string; size?: string; count?: number; output?: string; timeout?: number },
      ) => {
        const prompt = promptParts.join(' ').trim();
        if (!prompt) {
          console.error(colors.red('Prompt is required.'));
          process.exit(1);
        }

        const configPath = getContextWithOpts().configPath;
        const config = loadConfig(configPath);
        const outputDir = resolvePath(opts.output ?? './generated-images');
        await mkdir(outputDir, { recursive: true });

        const count = Number.isFinite(opts.count) && (opts.count ?? 0) > 0 ? Math.floor(opts.count!) : 1;

        try {
          const result = await generateImage({
            prompt,
            cfg: config,
            ...(opts.model ? { modelRef: opts.model } : {}),
            ...(opts.size ? { size: opts.size } : {}),
            count,
            ...(typeof opts.timeout === 'number' && opts.timeout > 0 ? { timeoutMs: opts.timeout } : {}),
          });

          const writtenPaths: string[] = [];
          for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            const fileName = img.fileName?.trim() || `image-${i + 1}.png`;
            const full = join(outputDir, fileName);
            await writeFile(full, img.buffer);
            writtenPaths.push(full);
          }

          console.log('');
          console.log(
            colors.green(
              `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} (model: ${result.model}).`,
            ),
          );
          for (const p of writtenPaths) console.log(`  - ${p}`);
          console.log('');
        } catch (err) {
          console.error(colors.red(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
      },
    );

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
