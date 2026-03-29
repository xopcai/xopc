/**
 * Optional package root entry; most integrations import `@xopcai/xopcbot/<subpath>`.
 */
import pkg from '../package.json' with { type: 'json' };

export const version: string = pkg.version;
