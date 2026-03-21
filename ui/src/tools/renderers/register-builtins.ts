import { registerToolRenderer } from '../renderer-registry.js';
import { BashRenderer } from './BashRenderer.js';

registerToolRenderer('bash', new BashRenderer());
