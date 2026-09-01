import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_PACKAGE = 'ai.xopc.xopc';
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = resolve(appDir, 'google-services.json');
const configuredSource = process.env.GOOGLE_SERVICES_JSON?.trim();
const sourcePath = configuredSource ? resolve(configuredSource) : targetPath;

if (!existsSync(sourcePath)) {
  console.error(
    'Error: Android push notifications require apps/mobile-expo/google-services.json. '
      + 'Download it from the Firebase Android app for ai.xopc.xopc, or provide an EAS file '
      + 'environment variable named GOOGLE_SERVICES_JSON.',
  );
  process.exit(1);
}

if (sourcePath !== targetPath) {
  copyFileSync(sourcePath, targetPath);
}

let config;
try {
  config = JSON.parse(readFileSync(targetPath, 'utf8'));
} catch (error) {
  console.error(`Error: invalid google-services.json: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const matchingClient = Array.isArray(config?.client)
  ? config.client.find(
      (client) => client?.client_info?.android_client_info?.package_name === APP_PACKAGE,
    )
  : undefined;
const projectNumber = config?.project_info?.project_number;
const projectId = config?.project_info?.project_id;
const mobileSdkAppId = matchingClient?.client_info?.mobilesdk_app_id;

if (!matchingClient || !projectNumber || !projectId || !mobileSdkAppId) {
  console.error(
    `Error: google-services.json must belong to the Firebase Android app ${APP_PACKAGE} `
      + 'and include project_number, project_id, and mobilesdk_app_id.',
  );
  process.exit(1);
}

console.log(`Validated Firebase Android client configuration for ${APP_PACKAGE}.`);
