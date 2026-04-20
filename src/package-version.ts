import pkg from '../package.json' with { type: 'json' };

/** Root `package.json` `version` (CLI, gateway, About UI). */
export const PACKAGE_VERSION: string = pkg.version;
