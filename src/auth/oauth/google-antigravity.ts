/**
 * Google Antigravity OAuth.
 * Implementation is vendored under `vendor-pi-google/` — upstream removed these exports from
 * `@earendil-works/pi-ai/oauth` while keeping the same OAuth credential shape.
 */

export {
	antigravityOAuthProvider as googleAntigravityOAuthProvider,
	loginAntigravity,
	refreshAntigravityToken,
} from './vendor-pi-google/google-antigravity.js';
