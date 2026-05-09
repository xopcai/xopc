/**
 * Google Gemini CLI (Cloud Code Assist) OAuth.
 * Implementation is vendored under `vendor-pi-google/` — upstream removed these exports from
 * `@earendil-works/pi-ai/oauth` while keeping the same OAuth credential shape.
 */

export {
	geminiCliOAuthProvider as googleGeminiCliOAuthProvider,
	loginGeminiCli,
	refreshGoogleCloudToken,
} from './vendor-pi-google/google-gemini-cli.js';
